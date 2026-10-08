import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { JourneyStoreFactory } from '../journey/journey-store-factory';
import { JourneyWriteFailed } from '../journey/journey-write-failed';
import { OperatorLog } from '../support/operator-log';
import { addTrace } from './trace';

/**
 * Ported from storefront-lamp/core/Http/Middleware/JourneyStateMiddleware.php. Writes the
 * journey's durable state back once, after everything downstream — `stepGuard`, `templateGlobals`,
 * Nest's own guard -> interceptor -> pipe -> controller stage — is truly finished with it.
 *
 * **This is the load-bearing middleware the whole "keep the pinned pipeline as middleware, not
 * guards" decision exists to protect (MERN.md's "The middleware pipeline" section).** If
 * `stepGuard` were a Nest `CanActivate` guard instead of middleware, guards run in a fixed position
 * *after* all middleware — so a guard-redirected visitor's journey state would never reach this
 * flush, because middleware's completion signal fires the moment the guard short-circuits, with
 * nothing left downstream to await.
 *
 * **Implementation note — this is NOT `try { await next() } finally { flush() }`, and that isn't
 * a style choice.** MERN.md's own snippet proposes exactly that pattern, and it is wrong for
 * Express-style Nest middleware with an async downstream handler: `next()` is a plain callback,
 * not a promise tied to when the response is actually finished, so `await next()` resolves as soon
 * as the synchronous part of dispatching the next layer returns — typically *before* an async
 * controller has done any of its work. This was verified empirically before writing this file: a
 * `try { await next() } finally {...}` middleware wrapping a controller that does
 * `await sleep(50)` before mutating state runs its `finally` block before the controller's mutation
 * happens, every time.
 *
 * **A second, real race sat in this file's first fix.** The original approach flushed from
 * `res.on('finish', ...)` — fine for *whether* the flush runs (it fires after a normal async
 * controller, a redirect-without-`next()`, or a thrown exception all fully resolve), but `finish`
 * means the response has already been sent, and `intake.js`'s `save()`/`submit()` post through
 * `fetch()`, which auto-follows the very 303 this request answers with. That follow-up GET is a
 * **second, independent request**, and on localhost its round trip is fast enough to reach this
 * server and read the session row again before the first request's fire-and-forget flush (kicked
 * off only after the response was already gone) had actually finished writing it. Confirmed live:
 * the identical save sequence persisted a visitor's just-typed answers most runs and silently
 * dropped them on others, purely on timing — indistinguishable from data loss to whoever hit the
 * slow run.
 *
 * Fixed by holding the response open until the flush resolves, instead of firing it after the
 * response is already gone: `res.end` — which `res.json()`/`res.redirect()`/`res.render()` all
 * funnel through in Express — is wrapped to await the flush first. Nothing downstream that reads
 * the DB can now observe this request's session row before its own write has landed. `finish`
 * fires strictly after `end()` completes, so this delays `finish` too, by one local DB write —
 * imperceptible to a visitor. Every existing guarantee about *whether* the flush runs is
 * unchanged; only *when* it runs relative to the response moved earlier. (Because the flush
 * itself doesn't touch the response, this is unlike `RetiredSessionMiddleware`'s need to mutate
 * headers, which needs the earlier `res.writeHead` hook instead — see that file's note.)
 *
 * Pinned slot 7 of 9 — wraps 8 (`stepGuard`) and 9 (`templateGlobals`).
 */
@Injectable()
export class JourneySaveBackMiddleware implements NestMiddleware {
  constructor(
    private readonly journeyStoreFactory: JourneyStoreFactory,
    private readonly log: OperatorLog,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    addTrace(res, 'journeySaveBack');

    // Idempotent by construction: a response can reach `close` after `end` already triggered the
    // real flush, or — for a connection the visitor aborted before any body was sent — `close`
    // may fire with `end` never called at all. Either way this must run the write-back exactly
    // once.
    let flushPromise: Promise<void> | null = null;
    const ensureFlushed = (): Promise<void> => {
      flushPromise ??= this.flush();
      return flushPromise;
    };

    // Delay the response's own completion until the flush lands (see the doc comment above) —
    // deliberately not `res.on('finish', ...)` alone, which fires only once the bytes are already
    // on the wire, late enough for a fast follow-up request to win the race against this write.
    const originalEnd = res.end.bind(res);
    res.end = ((...args: Parameters<Response['end']>) => {
      void ensureFlushed().finally(() => originalEnd(...args));
      return res;
    }) as Response['end'];

    res.on('close', () => {
      void ensureFlushed();
    });

    next();
  }

  private async flush(): Promise<void> {
    let journey;
    try {
      journey = this.journeyStoreFactory.get();
      await journey.flush();
    } catch (e) {
      this.log.error('journey.save_failed', {
        session: journey?.sessionUuid() ?? null,
        exception: e instanceof Error ? e.constructor.name : 'unknown',
        reason: e instanceof JourneyWriteFailed ? e.message : undefined,
      });
    }
  }
}

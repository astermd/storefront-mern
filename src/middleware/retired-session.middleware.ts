import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { FlowDefinition } from '../funnel/flow-definition';
import { JourneyStoreFactory } from '../journey/journey-store-factory';
import { SessionOptions } from '../journey/session-options';
import { addTrace } from './trace';

/**
 * Ported from storefront-lamp/core/Http/Middleware/RetiredSessionMiddleware.php. Ends the
 * analytics session of a journey that has completed, on the first request that is not the receipt
 * itself (`[4.18]`, `[4.19]`).
 *
 * **Position in the pipeline is load-bearing, and it is *outside* `AttributionMiddleware`.** The
 * cookie is issued by that middleware, and `Set-Cookie` headers are applied by a browser in
 * order — so a clear added before it would be overwritten by the re-issue it is meant to cancel.
 * See this file's implementation note below for how that ordering is achieved without PHP's
 * immutable-response wrapping.
 *
 * Everything about it fails open: an unreachable journey store or an unresolvable path each leave
 * the cookie alone.
 *
 * **Implementation note — why this doesn't just do work after `next()`:** the naive Express
 * translation of PHP's "call the handler, then inspect/mutate the response it returns" pattern is
 * `next(); /* read state, append header *\/` — but Express's `next()` schedules the rest of the
 * chain and returns immediately; it does not wait for an async downstream handler to finish (see
 * `journey-save-back.middleware.ts`'s note for the empirical proof, and MERN.md's incorrect claim
 * to the contrary). Worse, even a correct "wait for completion" signal like `res.on('finish')`
 * fires *after* headers are already sent, which is too late to append a `Set-Cookie` here. What
 * this needs is "run right before the response actually goes out, whatever ends up deciding that
 * moment" — so it patches `res.writeHead`, the one call every code path (a normal render, a
 * redirect, an error page) funnels through immediately before sending. Registering this patch
 * before calling `next()` means it wraps everything downstream, including whatever the eventual
 * controller mutated `journeyStore`'s state to, and — because `AttributionMiddleware` (slot 5,
 * inside this one) sets its own `Set-Cookie` synchronously before its own `next()` — this
 * middleware's patched `writeHead` still runs after that append, so the clear correctly lands
 * later in the header list and wins.
 *
 * Pinned slot 4 of 9.
 */
@Injectable()
export class RetiredSessionMiddleware implements NestMiddleware {
  constructor(
    private readonly journeyStoreFactory: JourneyStoreFactory,
    private readonly options: SessionOptions,
    private readonly flow: FlowDefinition,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    addTrace(res, 'retiredSession');

    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = ((...args: Parameters<typeof res.writeHead>) => {
      if (this.shouldClear(req) && !res.headersSent) {
        res.append('Set-Cookie', this.expiredCookie(req));
      }
      return originalWriteHead(...args);
    }) as typeof res.writeHead;

    next();
  }

  private shouldClear(req: Request): boolean {
    let state;
    try {
      state = this.journeyStoreFactory.get().currentState();
    } catch {
      return false;
    }

    if (state === null || !state.sessionRetired) return false;

    return this.flow.stepForPath(req.path) !== 'receipt';
  }

  private expiredCookie(req: Request): string {
    const forwardedProto = req.get('X-Forwarded-Proto');
    const scheme = (forwardedProto ?? req.protocol).toLowerCase();

    const parts = [
      `${this.options.cookieName}=`,
      'Path=/',
      'Max-Age=0',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'HttpOnly',
      'SameSite=Lax',
    ];

    if (scheme === 'https') {
      parts.push('Secure');
    }

    return parts.join('; ');
  }
}

import { All, Controller, Injectable, Module, NestMiddleware, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CoreModule } from '../src/core/core.module';
import { JourneyStore } from '../src/journey/journey-store';
import { JourneySaveBackMiddleware } from '../src/middleware/journey-save-back.middleware';
import { createTestApp } from './support/test-app';

/**
 * The port's canonical middleware-ordering regression file (Phase 11's
 * `test/middleware-ordering.e2e-spec.ts`, consolidated from Phase 2's own `middleware-pipeline.
 * e2e-spec.ts` — same file, renamed to match). Proves Phase 2's "done" bar: the exact 9-slot order,
 * a CSRF rejection stopping the pipeline before the save-back/guard/globals slots ever run, and
 * `JourneySaveBackMiddleware`'s flush surviving a downstream redirect (below).
 *
 * **Not included, deliberately: a Set-Cookie-ordering assertion under "a simulated retire+re-mint
 * in one request"** (Phase 2's original done-bar wording). `RetiredSessionMiddleware.shouldClear()`
 * requires `state.sessionRetired === true` on the state loaded from the *incoming* cookie — which
 * means a cookie was already present, so `AttributionMiddleware` never re-mints on that same
 * request. The one thing that could make both fire together is `SessionResolver`'s `remint()` path
 * (an existing cookie's session no longer recognised by the EMR) — and the plan's own "Corrections
 * found during implementation" section documents that path as out of scope for this port's reduced
 * `SessionResolver` for now. So "retire and mint together" isn't a scenario this port's current
 * code can actually reach yet, not just one nobody wrote a test for; forcing a synthetic pipeline
 * to fake it would test an interaction the real app cannot produce. The ordering *invariant* itself
 * is still locked down structurally: `retiredSession` (slot 4) is registered before `attribution`
 * (slot 5) in the "9 slots in order" test below, and `RetiredSessionMiddleware`'s own doc comment
 * explains why registering before `next()` — patching `res.writeHead` rather than acting
 * immediately — is what makes its clear win the header race whenever both do fire. Revisit with a
 * real Set-Cookie-order test once `SessionResolver.remint()` is real.
 */
describe('Middleware pipeline (Phase 2)', () => {
  const ORDER = [
    'canonicalUrl',
    'seo',
    'session',
    'retiredSession',
    'attribution',
    'csrf',
    'journeySaveBack',
    'stepGuard',
    'templateGlobals',
  ];

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
  });

  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createTestApp(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs all 9 slots in the documented order', async () => {
    const res = await request(app.getHttpServer()).get('/health/');
    const trace = ([] as string[]).concat(res.headers['x-mw-trace'].split(', '));
    expect(trace).toEqual(ORDER);
  });

  it('stops the pipeline at csrf for a rejected mutation, never reaching the save-back/guard/globals slots', async () => {
    const res = await request(app.getHttpServer()).post('/whatever-does-not-exist');
    expect(res.status).toBe(419);
    const trace = ([] as string[]).concat(res.headers['x-mw-trace'].split(', '));
    expect(trace).toEqual(['canonicalUrl', 'seo', 'session', 'retiredSession', 'attribution', 'csrf']);
  });
});

/**
 * The single most important regression test in this port: `JourneySaveBackMiddleware`'s flush
 * must still run when a downstream slot short-circuits with a redirect instead of calling
 * `next()` — this is the entire reason MERN.md keeps the pinned slots as Nest middleware rather
 * than guards (a `CanActivate` guard runs in a fixed position after ALL middleware, so a
 * guard-based redirect could never reach a middleware's `res.on('finish')`/`finally`).
 *
 * Exercises the *real* `JourneySaveBackMiddleware` class, composed in a minimal standalone module
 * alongside a redirecting stub — not `AppModule` with an overridden `StepGuardMiddleware`, because
 * `@nestjs/testing`'s `overrideProvider` was empirically found NOT to affect what a
 * `MiddlewareConsumer.apply()` call resolves (verified: the overridden class was never invoked at
 * the HTTP layer even though `moduleRef.get()` returned it correctly) — a Nest limitation specific
 * to middleware, not a general testing-seam problem. Phase 4, once `StepGuardMiddleware` is real,
 * should extend this same standalone-module pattern rather than trying to override it inside
 * `AppModule`.
 */
describe('JourneySaveBackMiddleware wraps a redirecting downstream slot (Phase 2)', () => {
  @Injectable()
  class RedirectingMiddlewareStub implements NestMiddleware {
    use(_req: Request, res: Response, _next: NextFunction): void {
      res.redirect(303, '/');
      // Deliberately never calls next() — simulates what the real Phase 4 StepGuardMiddleware
      // does on a failed precondition.
    }
  }

  @Controller()
  class NeverReachedController {
    @All('*splat')
    ok() {
      return { ok: true };
    }
  }

  @Module({
    imports: [CoreModule],
    controllers: [NeverReachedController],
    providers: [JourneySaveBackMiddleware, RedirectingMiddlewareStub],
  })
  class MiniPipelineModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
      consumer.apply(JourneySaveBackMiddleware, RedirectingMiddlewareStub).forRoutes('*');
    }
  }

  let app: NestExpressApplication;
  let flushSpy: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [MiniPipelineModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    await app.init();
    flushSpy = jest.spyOn(JourneyStore.prototype, 'flush');
  });

  afterEach(() => {
    flushSpy.mockClear();
  });

  afterAll(async () => {
    flushSpy.mockRestore();
    await app.close();
  });

  it("still calls flush() even though the downstream slot redirected instead of calling next()", async () => {
    const res = await request(app.getHttpServer()).get('/anything');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/');
    expect(flushSpy).toHaveBeenCalledTimes(1);
  });
});

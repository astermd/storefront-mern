import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { JourneyStoreFactory } from '../journey/journey-store-factory';
import { SessionOptions } from '../journey/session-options';
import { SessionResolution } from '../journey/session-resolution';
import { SessionResolver } from '../journey/session-resolver';
import { OperatorLog } from '../support/operator-log';
import { RouteExistsChecker } from '../support/route-exists-checker';
import { addTrace } from './trace';

/**
 * Ported from storefront-lamp/core/Http/Middleware/AttributionMiddleware.php. Resolves the
 * visitor's analytics session, then publishes the result to the rest of the request.
 *
 * Also the error boundary for the whole of session resolution: an unreachable database or a
 * failed EMR call must never break the page (`[20.1]`, `[20.2]`) — wrapped here, in one auditable
 * place, rather than swallowed piecemeal inside the repository/gateway layer.
 *
 * A session is only minted for a plain GET on a path that isn't an excluded machine endpoint and
 * that names a real route — see `mayCreate()`. The PHP original's equivalent is an injected "does
 * this route exist" closure; this port's is `RouteExistsChecker`, which introspects Express's own
 * router. Matters now that it didn't under the old Null-only scope: `EmrSessionGateway` really
 * calls `@astermd-hq/sdk` when `config.app.session.analytics` is on, so a GET to an unmatched path
 * (a bot scan, a stray asset request) would otherwise mint a real, billable EMR session before
 * `NotFoundController` ever got a say.
 *
 * Unlike `RetiredSessionMiddleware` and `JourneySaveBackMiddleware`, this middleware doesn't need
 * to wrap the rest of the pipeline: everything it decides (the session uuid, whether to issue a
 * cookie) is known *before* calling `next()`, so the `Set-Cookie` header is appended immediately,
 * synchronously, ahead of it — no `res.on('finish')`/`writeHead`-patch machinery required. This
 * also happens to be exactly what makes `RetiredSessionMiddleware`'s later (send-time) clear
 * correctly win the ordering race against this middleware's earlier append.
 *
 * Pinned slot 5 of 9.
 */
@Injectable()
export class AttributionMiddleware implements NestMiddleware {
  constructor(
    private readonly resolver: SessionResolver,
    private readonly journeyStoreFactory: JourneyStoreFactory,
    private readonly options: SessionOptions,
    private readonly log: OperatorLog,
    private readonly routes: RouteExistsChecker,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    addTrace(res, 'attribution');

    let resolution: SessionResolution;
    try {
      resolution = await this.resolver.resolve(req, this.journeyStoreFactory.get(), this.mayCreate(req));
    } catch (e) {
      this.log.error('session.resolve_failed', {
        path: req.path,
        exception: e instanceof Error ? e.constructor.name : 'unknown',
        message: e instanceof Error ? e.message : String(e),
      });
      resolution = new SessionResolution(null);
    }

    (req as { sessionUuid?: string | null }).sessionUuid = resolution.sessionUuid;

    if (resolution.sessionUuid !== null && resolution.issueCookie) {
      res.append('Set-Cookie', this.cookie(req, resolution.sessionUuid));
    }

    next();
  }

  private mayCreate(req: Request): boolean {
    if (req.method !== 'GET') return false;
    if (this.options.excludePaths.some((excluded) => req.path.startsWith(excluded))) return false;

    return this.routes.exists(req.path);
  }

  /** The session cookie (`[4.6]`): 30 days, HTTP-only, same-site lax, secure over TLS. */
  private cookie(req: Request, uuid: string): string {
    const forwardedProto = req.get('X-Forwarded-Proto');
    const scheme = (forwardedProto ?? req.protocol).toLowerCase();
    const maxAge = this.options.lifetimeDays * 86400;
    const expires = new Date(Date.now() + maxAge * 1000).toUTCString();

    const parts = [
      `${this.options.cookieName}=${encodeURIComponent(uuid)}`,
      'Path=/',
      `Max-Age=${maxAge}`,
      `Expires=${expires}`,
      'HttpOnly',
      'SameSite=Lax',
    ];

    if (scheme === 'https') {
      parts.push('Secure');
    }

    return parts.join('; ');
  }
}

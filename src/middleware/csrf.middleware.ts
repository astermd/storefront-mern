import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { addTrace } from './trace';

/**
 * Ported from storefront-lamp/core/Http/Middleware/CsrfMiddleware.php. Issues (or reuses) a
 * per-session CSRF token and rejects mutating requests that don't echo it back. The token is
 * minted lazily on every request, not just mutating ones, so it's already sitting in the session
 * by the time a form is rendered.
 *
 * Uses `req.session` (from `SessionMiddleware`, slot 3 — outside this one, so the session already
 * exists) in place of PHP's `$_SESSION`.
 *
 * Pinned slot 6 of 9.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private static readonly MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  use(req: Request, res: Response, next: NextFunction): void {
    addTrace(res, 'csrf');

    if (typeof req.session._csrf !== 'string') {
      req.session._csrf = randomBytes(32).toString('hex');
    }
    const token = req.session._csrf;

    if (CsrfMiddleware.MUTATING.has(req.method)) {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const sent = String(body._csrf ?? req.get('X-CSRF-Token') ?? '');

      if (sent === '' || !CsrfMiddleware.safeEqual(token, sent)) {
        res
          .status(419)
          .send('Session expired or invalid form token. Go back, refresh the page, and try again.');
        return;
      }
    }

    (req as { csrfToken?: string }).csrfToken = token;
    next();
  }

  /** Guards against timing attacks on the comparison, matching PHP's `hash_equals()`. */
  private static safeEqual(expected: string, actual: string): boolean {
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(actual);
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  }
}

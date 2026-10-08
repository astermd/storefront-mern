import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import session from 'express-session';
import { addTrace } from './trace';

/**
 * Ported from storefront-lamp/core/Http/Middleware/SessionMiddleware.php — starts the session
 * with cookie settings tuned for this storefront's long checkout journey. Wraps `express-session`
 * (Node's equivalent of PHP's native session mechanism) rather than reimplementing it; MERN.md
 * calls this out explicitly ("session (express-session, wrapped as Nest middleware)").
 *
 * `MemoryStore` (express-session's default) is used deliberately — see the plan's open design
 * decisions: nothing durable lives in this session, only a CSRF token and whatever
 * `AttributionMiddleware` reads off the cookie itself; durable journey state lives in
 * `sessions.journey_state` (Phase 3), not here. `secure` trusts `X-Forwarded-Proto` for the same
 * reason the PHP original does — the shipped nginx/apache configs front the app this way.
 *
 * Pinned slot 3 of 9.
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  private readonly handler = session({
    secret: process.env.SESSION_SECRET ?? 'change-me-in-every-real-environment',
    resave: false,
    saveUninitialized: false,
    name: 'amd_php_session',
    proxy: true,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 30,
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      path: '/',
    },
  });

  use(req: Request, res: Response, next: NextFunction): void {
    addTrace(res, 'session');
    this.handler(req, res, next);
  }
}

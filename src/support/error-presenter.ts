import { randomBytes } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RobotsPolicy } from '../seo/robots-policy';
import { OperatorLog } from './operator-log';

/**
 * Ported from the error routing in storefront-lamp/core/Bootstrap/AppFactory.php. Slim only needs
 * one error boundary; Nest needs two — one on the raw Express instance for the pinned middleware's
 * own errors, one as a Nest global exception filter for guard/pipe/controller errors (see
 * MERN.md's "Error handling" section) — so this is the single place the shared three-tier logic
 * lives, called from both registrations.
 *
 * Tiers, checked in order: 404 gets the themed 404 page; a thrown HTTP exception with a 4xx status
 * gets the themed HTTP-error page and is deliberately *not* logged (these aren't crashes, just
 * malformed/disallowed requests); anything else is logged with a request id and gets the themed
 * 500 page carrying that same id.
 *
 * Every error response carries `X-Robots-Tag: noindex, nofollow` (`RobotsPolicy.REFUSED`) — it is
 * served at any URL at all, including one a crawler followed from somewhere, so a page that exists
 * only to report a failure refuses indexing itself rather than waiting for a rule that could never
 * name it.
 */
@Injectable()
export class ErrorPresenter {
  constructor(private readonly operatorLog: OperatorLog) {}

  render(exception: unknown, req: Request, res: Response): void {
    res.setHeader('X-Robots-Tag', RobotsPolicy.REFUSED);

    const status = ErrorPresenter.statusOf(exception);

    if (status === 404) {
      res.status(404).render('pages/error-404');
      return;
    }

    if (status >= 400 && status < 500) {
      res.status(status).render('pages/error-http', {
        status,
        message: ErrorPresenter.messageOf(exception),
      });
      return;
    }

    const requestId = randomBytes(8).toString('hex');
    // Path only, never the full URI: query strings carry tracking payloads and resume
    // identifiers, and key-based redaction cannot see inside a URI string (`[20.6]`).
    this.operatorLog.error('http.unhandled_exception', {
      request_id: requestId,
      method: req.method,
      path: req.path,
      session: (req as { session?: { uuid?: string } }).session?.uuid ?? null,
      message: ErrorPresenter.messageOf(exception),
      file: exception instanceof Error ? exception.stack : undefined,
    });

    res.status(500).render('pages/error-500', { request_id: requestId });
  }

  private static statusOf(exception: unknown): number {
    if (exception instanceof HttpException) return exception.getStatus();
    return 500;
  }

  private static messageOf(exception: unknown): string {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'string') return response;
      if (response && typeof response === 'object' && 'message' in response) {
        const message = (response as { message: unknown }).message;
        return Array.isArray(message) ? message.join(', ') : String(message);
      }
      return exception.message;
    }
    if (exception instanceof Error) return exception.message;
    return 'An unexpected error occurred.';
  }
}

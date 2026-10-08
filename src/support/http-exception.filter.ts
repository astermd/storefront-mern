import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorPresenter } from './error-presenter';

/**
 * Registered via `app.useGlobalFilters()` in main.ts — catches everything thrown from Nest's own
 * guard -> interceptor -> pipe -> controller stage (including a `NotFoundException` thrown by the
 * catch-all fallback route for an unmatched path, since Nest's router doesn't throw the way
 * Slim's does). The pinned middleware's own errors never reach this filter — those are caught by
 * the raw-Express error middleware registered in main.ts, sharing the same `ErrorPresenter`. See
 * MERN.md's "Error handling" section.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly errorPresenter: ErrorPresenter) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    this.errorPresenter.render(exception, req, res);
  }
}

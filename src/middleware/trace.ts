import type { Response } from 'express';

/**
 * Every pinned middleware in storefront-lamp takes a `$trace` constructor flag and, when it's on,
 * appends its own name to an `X-MW-Trace` response header on the way *out* (after calling
 * `$handler->handle()`), which — because each outer layer's append happens after every inner
 * layer's — produces the 9 names in innermost-to-outermost order.
 *
 * This port appends on the way *in* instead (before calling `next()`), producing the names in
 * the same outermost-to-innermost order the pipeline is documented in. `X-MW-Trace` exists purely
 * to make ordering assertable in tests, not as user-facing behavior, so the clearer order is
 * preferable to matching the PHP mechanism's incidental direction. Enabled only under
 * `NODE_ENV=test`, matching the PHP original's own test-only wiring.
 */
export function addTrace(res: Response, name: string): void {
  if (process.env.NODE_ENV !== 'test') return;
  res.append('X-MW-Trace', name);
}

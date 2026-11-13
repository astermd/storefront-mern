import type { Response } from 'express';

/**
 * Every pinned middleware appends its own name to an `X-MW-Trace` response header on the way
 * *in* (before calling `next()`), producing the names in the same outermost-to-innermost order the
 * pipeline is documented in. `X-MW-Trace` exists purely to make ordering assertable in tests, not
 * as user-facing behavior. Enabled only under `NODE_ENV=test`.
 */
export function addTrace(res: Response, name: string): void {
  if (process.env.NODE_ENV !== 'test') return;
  res.append('X-MW-Trace', name);
}

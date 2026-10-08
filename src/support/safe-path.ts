import { Url } from './url';

/**
 * Ported from storefront-lamp's `CartController::safePath()`. The open-redirect gate every
 * `return_to` value passes through before a cart mutation redirects back to it.
 *
 * Refuses (falls back to `/`): a non-string/empty value; anything not starting with exactly one
 * `/` (rejects schemeless `//host/...` redirects); a `\` anywhere (a browser normalizes `/\host`
 * toward `//host`); a control character; a `:` before the first `/` (defense in depth, redundant
 * given the leading-slash check). Otherwise splits at the first `?`, canonicalizes the path
 * portion only, and reattaches the query string verbatim, unmangled.
 */
export function safePath(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.includes('\\')) return '/';
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(value)) return '/';

  const firstSlash = value.indexOf('/');
  const firstColon = value.indexOf(':');
  if (firstColon !== -1 && firstColon < firstSlash) return '/';

  const queryIndex = value.indexOf('?');
  const path = queryIndex === -1 ? value : value.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : value.slice(queryIndex);

  return Url.canonicalizePath(path) + query;
}

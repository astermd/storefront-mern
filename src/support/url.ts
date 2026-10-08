/**
 * Ported from storefront-lamp/core/Support/Url.php. Path canonicalisation, shared by
 * `CanonicalUrlMiddleware` (which redirects non-canonical requests) and every `url()` call
 * templates make (which should never need a redirect in the first place). The canonical form is
 * always lowercase, has slash-runs collapsed, and — the root path aside — always ends in a single
 * trailing slash; changing any of those three rules changes what counts as a redirect-worthy URL
 * sitewide.
 */
export class Url {
  static canonicalizePath(path: string): string {
    const lowered = path.toLowerCase();
    const collapsed = lowered.replace(/\/{2,}/g, '/');
    const trimmed = collapsed.replace(/^\/+|\/+$/g, '');

    return trimmed === '' ? '/' : `/${trimmed}/`;
  }

  static build(path: string, query: Record<string, string> = {}): string {
    const url = Url.canonicalizePath(path);
    const entries = Object.entries(query);
    if (entries.length === 0) return url;

    const search = new URLSearchParams(entries).toString();
    return `${url}?${search}`;
  }
}

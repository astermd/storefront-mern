import type { Request } from 'express';

/**
 * Ported from storefront-lamp/core/Support/RequestContext.php. The client-facing facts a checkout
 * submission is judged by: its address (`[13.8]`, `[29.23]`) and its user agent.
 *
 * The client address is resolved through a fixed CDN header precedence rather than trusting
 * `req.ip` alone — a deployment behind a CDN/load balancer has the real client address only in one
 * of these headers, and trusting an arbitrary client-supplied header would let a flood guard be
 * defeated by whoever is being guarded against.
 */
export class RequestContext {
  /** Checked in order; the first present value wins. Ported verbatim from the PHP original's CDN_IP_HEADERS. */
  private static readonly CDN_IP_HEADERS = ['cf-connecting-ip', 'true-client-ip', 'x-real-ip', 'x-forwarded-for'];

  private constructor(
    public readonly clientIp: string | null,
    public readonly userAgent: string | null,
  ) {}

  static fromRequest(req: Request): RequestContext {
    return new RequestContext(RequestContext.resolveIp(req), RequestContext.resolveUserAgent(req));
  }

  private static resolveIp(req: Request): string | null {
    for (const header of RequestContext.CDN_IP_HEADERS) {
      const value = req.headers[header];
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === 'string' && first.trim() !== '') {
        // x-forwarded-for is a comma-separated chain; the first entry is the original client.
        return first.split(',')[0].trim();
      }
    }

    return req.ip ?? req.socket.remoteAddress ?? null;
  }

  private static resolveUserAgent(req: Request): string | null {
    const value = req.headers['user-agent'];
    const resolved = Array.isArray(value) ? value[0] : value;
    return typeof resolved === 'string' && resolved.trim() !== '' ? resolved : null;
  }
}

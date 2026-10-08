import { basename } from 'node:path';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Url } from '../support/url';
import { addTrace } from './trace';

/**
 * Ported from storefront-lamp/core/Http/Middleware/CanonicalUrlMiddleware.php. One-hop 301 to the
 * canonical URL form (spec §23): trailing slash, lowercase path, collapsed slashes. The query
 * string is preserved byte-for-byte — attribution and resume parameters ride there and must never
 * be re-encoded. Only safe methods redirect; redirecting a POST would drop its body.
 *
 * Pinned slot 1 of 9 — outermost. See MERN.md's "Why the positions are what they are".
 */
@Injectable()
export class CanonicalUrlMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    addTrace(res, 'canonicalUrl');

    const path = req.path;
    const canonical = Url.canonicalizePath(path);

    if (canonical !== path && ['GET', 'HEAD'].includes(req.method) && !this.pathIsFileLike(path)) {
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      res.redirect(301, canonical + query);
      return;
    }

    next();
  }

  /**
   * File-like final path segments (sitemap.xml, robots.txt, favicon.ico) are exempt from
   * canonicalisation: they're conventionally served without a trailing slash and must not 301
   * to one.
   */
  private pathIsFileLike(path: string): boolean {
    return basename(path).includes('.');
  }
}

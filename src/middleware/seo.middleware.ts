import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetaResolver } from '../seo/meta-resolver';
import { PageMeta } from '../seo/page-meta';
import { RobotsPolicy } from '../seo/robots-policy';
import { Url } from '../support/url';
import { addTrace } from './trace';

/**
 * Full port of storefront-lamp/core/Http/Middleware/SeoMiddleware.php. Publishes the request's SEO
 * context as a `seo` template local and enforces the indexing directive as a response header.
 *
 * `[24.2]` requires the indexing decision to be enforced **twice** — as a header and as a meta tag
 * — from a single config value. This middleware is the header half and the source of the value the
 * meta half renders (`seo.robots`, folded into `partials/head.ejs`'s existing `noindex` local when
 * a page doesn't pass its own), so the two cannot disagree.
 *
 * It sits immediately inside `CanonicalUrlMiddleware` and outside everything else: the canonical
 * URL it publishes must be built from the canonicalised path, and every response — including ones
 * no controller rendered — should carry the header, which rules out sitting inside the session/
 * journey/step-guard slots that can redirect a request away first.
 *
 * The error boundary sits **outside** this middleware (it renders on the raw Express instance, past
 * Nest's own pipeline), so an error response never passes back through here — `ErrorPresenter` sets
 * the same header itself for that reason, from the same `RobotsPolicy.REFUSED` constant.
 *
 * Pinned slot 2 of 9 — inside `canonicalUrl`, outside everything else.
 */
@Injectable()
export class SeoMiddleware implements NestMiddleware {
  constructor(
    private readonly meta: MetaResolver,
    private readonly robots: RobotsPolicy,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    addTrace(res, 'seo');

    const path = Url.canonicalizePath(req.path);
    const directive = this.robots.directiveFor(path);

    res.locals.seo = {
      path,
      canonical: this.meta.canonical(path),
      robots: directive,
      site_name: this.meta.siteName(),
      default_title: this.meta.title(),
      default_description: this.meta.description(),
      // What a page's own `page_title`/`page_description` fold into via `.with(...)` — kept here
      // so the layout never has to spell out a directive of its own.
      page: PageMeta.forPath(this.meta, path, directive),
      refused: RobotsPolicy.REFUSED,
    };

    // The PHP original applies the header after the handler returns, checking whether the response
    // already carries one. Express has no "response object, still unsent" moment to hook the same
    // way, so this patches the last point before headers actually go out instead.
    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = ((...args: Parameters<typeof res.writeHead>) => {
      if (directive !== null && !res.hasHeader('X-Robots-Tag')) {
        res.setHeader('X-Robots-Tag', directive);
      }
      return originalWriteHead(...args);
    }) as typeof res.writeHead;

    next();
  }
}

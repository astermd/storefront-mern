import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CatalogProvider } from '../../catalog/catalog-provider';
import { MetaResolver } from '../../seo/meta-resolver';
import { RobotsPolicy } from '../../seo/robots-policy';

/** Candidates for the sitemap. Funnel steps are absent by construction as well as by policy — listing only the marketing surface means a new funnel route cannot be added here by forgetting a rule. */
const STATIC_PATHS = ['/', '/treatments/', '/terms/', '/privacy/', '/telehealth-consent/'];

/**
 * Ported from storefront-lamp/core/Http/Controller/SitemapController.php. `sitemap.xml` — every
 * indexable route and every catalog product (`[24.4]`).
 *
 * **What is not in it is the part worth reading.** `[24.6]` excludes the funnel — cart, intake,
 * checkout, upsell, verify, receipt — and this class carries no list of exclusions of its own: it
 * asks `RobotsPolicy`, the same object that decides whether the page emits `noindex`. Two lists
 * would drift; adding a funnel step later means adding one robots rule, not two entries in two
 * files.
 *
 * `[24.7]`'s master switch is honoured here too — under `discourageIndexing` the document is still
 * served but lists nothing, so `robots.txt` and `sitemap.xml` cannot tell a crawler different
 * stories.
 */
@Controller()
export class SitemapController {
  constructor(
    private readonly catalog: CatalogProvider,
    private readonly meta: MetaResolver,
    private readonly robots: RobotsPolicy,
  ) {}

  @Get('sitemap.xml')
  show(@Res() res: Response): void {
    res.type('application/xml; charset=utf-8').send(this.render(this.paths()));
  }

  private paths(): string[] {
    const paths = [...STATIC_PATHS];

    for (const product of this.catalog.listedProducts()) {
      const slug = product.slug ?? '';
      if (slug !== '') {
        paths.push(`/products/${slug}/`);
      }
    }

    return paths.filter((path) => this.robots.isIndexable(path));
  }

  /**
   * The document. `<loc>` and nothing else, deliberately — nothing in this application records when
   * a page's content last changed, so a `<lastmod>` here could only be fabricated; `<changefreq>`
   * and `<priority>` are hints the major crawlers ignore outright.
   */
  private render(paths: string[]): string {
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];

    for (const path of paths) {
      const encoded = SitemapController.escapeXml(this.meta.canonical(path));
      lines.push(`  <url><loc>${encoded}</loc></url>`);
    }

    lines.push('</urlset>');

    return lines.join('\n') + '\n';
  }

  private static escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
}

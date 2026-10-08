import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MetaResolver } from '../../seo/meta-resolver';
import { RobotsPolicy } from '../../seo/robots-policy';
import { ConfigService } from '../../support/config';

/**
 * Ported from storefront-lamp/core/Http/Controller/RobotsController.php. `robots.txt`, generated
 * from the same configuration the meta tags and the sitemap read (`[24.4]`).
 *
 * `[24.7]` — under `discourageIndexing` this is a blanket `Disallow: /` for every agent, because
 * the master switch has to be able to stop a staging deployment leaking regardless of any per-route
 * rule. The sitemap is still linked and still served; it is simply empty, so the two documents
 * cannot tell a crawler different stories.
 *
 * `[24.13]` — whether answer engines may ingest the catalog is a **commercial decision, not a
 * technical default**, so the AI crawler policy is configuration rather than a shipped opinion.
 */
@Controller()
export class RobotsController {
  constructor(
    private readonly config: ConfigService,
    private readonly meta: MetaResolver,
    private readonly robots: RobotsPolicy,
  ) {}

  @Get('robots.txt')
  show(@Res() res: Response): void {
    res.type('text/plain; charset=utf-8').send(this.render());
  }

  private render(): string {
    const lines: string[] = [];

    if (this.robots.indexingDiscouraged()) {
      lines.push('User-agent: *', 'Disallow: /');
    } else {
      lines.push('User-agent: *');

      const refused = this.refusedPaths();
      for (const path of refused) {
        lines.push(`Disallow: ${path}`);
      }

      // A `User-agent` group with no directive under it is an incomplete record, and a deployment
      // that fences nothing off is an ordinary one.
      if (refused.length === 0) {
        lines.push('Allow: /');
      }

      lines.push(...this.aiCrawlerLines());
    }

    lines.push('', `Sitemap: ${this.meta.canonical('/')}sitemap.xml`);

    return lines.join('\n') + '\n';
  }

  /**
   * The paths crawlers are asked to stay out of, taken from the same rules that produce the
   * `noindex` directives — routed through `RobotsPolicy.refusesIndexing()` rather than classifying
   * the directive text itself, so the most specific rule wins here exactly as it does everywhere
   * else and a path merely qualifying indexing (`noarchive`) is not disallowed.
   *
   * A trailing `*` is dropped: `robots.txt` paths are already prefixes, so `Disallow: /checkout/`
   * covers everything beneath it.
   */
  private refusedPaths(): string[] {
    const rules = this.config.app.seo.robotsRules;

    const paths = new Set<string>();
    for (const pattern of Object.keys(rules)) {
      const path = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
      if (this.robots.refusesIndexing(path)) {
        paths.add(path);
      }
    }

    return [...paths].sort();
  }

  /** `[24.13]`. An allowing deployment emits nothing — silence is already permission. */
  private aiCrawlerLines(): string[] {
    if (this.config.app.seo.aiCrawlers.allow) {
      return [];
    }

    const lines: string[] = [];
    for (const agent of this.config.app.seo.aiCrawlers.agents) {
      const trimmed = agent.trim();
      if (trimmed === '') continue;

      lines.push('', `User-agent: ${trimmed}`, 'Disallow: /');
    }

    return lines;
  }
}

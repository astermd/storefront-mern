import { ConfigService } from '../support/config';

/** Ranks below every real match, so a rule that matches nothing can never win. */
const NO_MATCH = -1;

/**
 * Ported from storefront-lamp/core/Seo/RobotsPolicy.php. The single answer to "may this path be
 * indexed", consulted by everything that needs to know.
 *
 * There is one writer of that decision on purpose. `[24.2]` requires the directive to be enforced
 * twice — as a header *and* a meta tag — which is only safe when both readings come from one
 * source. The same object answers `[24.6]`: a path that may not be indexed is a path that may not
 * appear in the sitemap, derived rather than a second hand-kept list.
 *
 * `[24.7]`'s master switch sits above all of it: when `discourageIndexing` is on, every path is
 * refused regardless of any per-route rule, because a staging deployment must not be able to leak
 * into an index through one mis-set page.
 */
export class RobotsPolicy {
  /** What a refused path emits. `nofollow` too: a noindex page's links are not endorsements. */
  static readonly REFUSED = 'noindex, nofollow';

  constructor(
    private readonly rules: Record<string, string>,
    private readonly discourageIndexing: boolean,
  ) {}

  static fromConfig(config: ConfigService): RobotsPolicy {
    return new RobotsPolicy(config.app.seo.robotsRules, config.app.seo.discourageIndexing);
  }

  /**
   * The directive for `path`, or null when the path may be indexed freely. Null rather than an
   * `index, follow` string — the absence of a directive is what "indexable" means to a crawler.
   */
  directiveFor(path: string): string | null {
    if (this.discourageIndexing) {
      return RobotsPolicy.REFUSED;
    }

    return this.matchRule(path);
  }

  /**
   * Whether `path`'s directive keeps it out of an index altogether, as opposed to merely
   * qualifying how it appears in one. **Having a directive is not the same as being refused** —
   * `noarchive`/`nosnippet` still index the page, so only a directive actually containing `noindex`
   * counts.
   */
  refusesIndexing(path: string): boolean {
    const directive = this.directiveFor(path);
    return directive !== null && directive.toLowerCase().includes('noindex');
  }

  /** Whether `path` may appear in `sitemap.xml` (`[24.6]`) — the negation of `refusesIndexing()`, derived rather than a second list. */
  isIndexable(path: string): boolean {
    return !this.refusesIndexing(path);
  }

  /** Whether the deployment refuses indexing outright (`[24.7]`) — `robots.txt` needs this separately, since the master switch turns the whole file into a blanket disallow. */
  indexingDiscouraged(): boolean {
    return this.discourageIndexing;
  }

  /**
   * The most specific matching rule's directive. Exact paths beat prefixes, and a longer prefix
   * beats a shorter one, so `/checkout/promo/` can be governed separately from `/checkout/*`
   * without the order of the config object deciding the outcome.
   */
  private matchRule(path: string): string | null {
    let best: string | null = null;
    let bestRank = NO_MATCH;

    for (const [pattern, directive] of Object.entries(this.rules)) {
      const rank = RobotsPolicy.specificity(pattern, path);
      if (rank > bestRank) {
        best = directive;
        bestRank = rank;
      }
    }

    return best;
  }

  /**
   * How specific `pattern`'s match against `path` is, or `NO_MATCH`. Doubled, with an exact match
   * taking the odd number, so an exact rule outranks a prefix rule of the same length — `/faq/` and
   * `/faq/*` both score five characters, and the tie must not be resolved by object key order.
   */
  private static specificity(pattern: string, path: string): number {
    if (!pattern.endsWith('*')) {
      return pattern === path ? pattern.length * 2 + 1 : NO_MATCH;
    }

    const prefix = pattern.slice(0, -1);
    return path.startsWith(prefix) ? prefix.length * 2 : NO_MATCH;
  }
}

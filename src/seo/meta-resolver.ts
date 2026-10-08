import { Injectable } from '@nestjs/common';
import { ConfigService } from '../support/config';
import { Url } from '../support/url';

export interface SocialCard {
  title: string;
  description: string;
  url: string;
  site_name: string;
  image: string | null;
  type: string;
}

/**
 * Ported from storefront-lamp/core/Seo/MetaResolver.php. Builds every page's metadata from
 * configuration and catalog data, so a client gets correct titles, descriptions, canonical links
 * and social cards without writing any code (`[24.4]`).
 *
 * The resolution order is the whole point of the class, and it is the same for every field: **a
 * per-page override, then the page's own data, then the configured default.**
 *
 * One consequence is load-bearing rather than theoretical: every product synced from this EMR
 * carries an empty description, so an empty string falls *through* to the next source rather than
 * satisfying the chain — absent and blank mean the same thing to a crawler, so they mean the same
 * thing here.
 */
@Injectable()
export class MetaResolver {
  constructor(private readonly config: ConfigService) {}

  /**
   * The page title, wrapped in the configured template. A page that supplies nothing gets
   * `defaultTitle` **verbatim, without the template** — templating it would render "AsterMD —
   * AsterMD" on the homepage.
   *
   * `%s` is substituted rather than formatted with `sprintf`-style semantics, since a title
   * template is copy that may contain a literal `%` (`'%s | 50% off'`) — substitution replaces
   * every `%s` rather than throwing on the extra `%`.
   */
  title(pageTitle: string | null = null): string {
    const resolved = MetaResolver.firstNonBlank(pageTitle);
    const seo = this.config.app.seo;

    if (resolved === null) {
      return seo.defaultTitle;
    }

    return seo.titleTemplate.includes('%s') ? seo.titleTemplate.replace(/%s/g, resolved) : resolved;
  }

  /** The meta description (`[24.4]`) — candidates tried in order, blank ones skipped, before the configured default. */
  description(...candidates: Array<string | null | undefined>): string {
    for (const candidate of candidates) {
      const value = MetaResolver.firstNonBlank(candidate);
      if (value !== null) return value;
    }

    return this.config.app.seo.defaultDescription;
  }

  /**
   * The absolute canonical URL for `path` (`[23.6]`). Absolute rather than root-relative because a
   * canonical link is a statement about which host owns the content. The path is put through the
   * same `Url.canonicalizePath()` the redirect uses, so a link built by hand in the non-canonical
   * form still names the canonical one.
   */
  canonical(path: string): string {
    const base = this.config.app.url.replace(/\/+$/, '');
    return base + Url.canonicalizePath(path);
  }

  siteName(): string {
    return this.config.app.seo.siteName || this.config.app.name;
  }

  /**
   * The social sharing card (`[24.4]`) — shares the resolved title and description rather than
   * resolving them a second time.
   */
  social(path: string, title: string, description: string, type = 'website'): SocialCard {
    return {
      title,
      description,
      url: this.canonical(path),
      site_name: this.siteName(),
      image: this.socialImage(),
      type,
    };
  }

  /** The absolute URL of the configured social image, or null when none is set. */
  private socialImage(): string | null {
    const image = MetaResolver.firstNonBlank(this.config.app.seo.socialImage);
    if (image === null) return null;

    if (image.startsWith('http://') || image.startsWith('https://')) return image;

    return `${this.config.app.url.replace(/\/+$/, '')}/${image.replace(/^\/+/, '')}`;
  }

  /** Trimmed, or null when absent/not-a-string/blank — blank counts as absent throughout this class. */
  private static firstNonBlank(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
}

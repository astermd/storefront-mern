import { MetaResolver, SocialCard } from './meta-resolver';

const DEFAULT_TYPE = 'website';

/**
 * Ported from storefront-lamp/core/Seo/PageMeta.php. One page's resolved metadata — everything the
 * layout renders into `<head>` and nothing else.
 *
 * Exists so the layout has a single object to read from rather than a resolution chain to re-run
 * per tag. The values are resolved once, on construction, so the `<title>`, the description, the
 * canonical link and the social card cannot disagree with each other: the card shares the same two
 * strings the page itself renders.
 */
export class PageMeta {
  private constructor(
    private readonly resolver: MetaResolver,
    private readonly path: string,
    public readonly title: string,
    public readonly description: string,
    public readonly canonical: string,
    public readonly robots: string | null,
    public readonly social: SocialCard,
  ) {}

  /** The metadata a request has before any page has spoken: configured defaults, the canonical URL of the path, and the indexing directive `RobotsPolicy` decided for it. */
  static forPath(resolver: MetaResolver, path: string, robots: string | null): PageMeta {
    return PageMeta.resolve(resolver, path, robots, null, null, DEFAULT_TYPE);
  }

  /** The same metadata with this page's own contributions folded in. Null/blank arguments keep the default. */
  with(title: string | null = null, description: string | null = null, type: string | null = null): PageMeta {
    return PageMeta.resolve(this.resolver, this.path, this.robots, title, description, type ?? DEFAULT_TYPE);
  }

  private static resolve(
    resolver: MetaResolver,
    path: string,
    robots: string | null,
    title: string | null,
    description: string | null,
    type: string,
  ): PageMeta {
    const resolvedTitle = resolver.title(title);
    const resolvedDescription = resolver.description(description);

    return new PageMeta(resolver, path, resolvedTitle, resolvedDescription, resolver.canonical(path), robots, resolver.social(path, resolvedTitle, resolvedDescription, type));
  }
}

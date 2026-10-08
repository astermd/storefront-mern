import { Emitter } from './emitter';

export interface Crumb {
  name: string;
  url: string;
}

/**
 * Ported from storefront-lamp/core/Seo/StructuredData/BreadcrumbList.php. The trail from the
 * storefront root to the current page, as schema.org `BreadcrumbList` (`[24.8]`).
 *
 * A trail of one crumb is not emitted at all: "Home" on the home page is a breadcrumb list with
 * nothing to navigate.
 */
export class BreadcrumbList implements Emitter {
  /** @param crumbs root first, current page last */
  constructor(private readonly crumbs: Crumb[]) {}

  emit(): Record<string, unknown> | null {
    if (this.crumbs.length < 2) return null;

    const items = this.crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    }));

    return { '@type': 'BreadcrumbList', itemListElement: items };
  }
}

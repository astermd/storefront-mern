import { Emitter } from './emitter';

/**
 * Ported from storefront-lamp/core/Seo/StructuredData/Organisation.php. The organisation behind the
 * storefront, as schema.org `Organization` (`[24.8]`).
 *
 * Everything it publishes is already public on the site itself. The `@id` is stable and absolute so
 * `WebSite` can name this node as its publisher instead of repeating it.
 */
export class Organisation implements Emitter {
  constructor(
    private readonly baseUrl: string,
    private readonly name: string,
    private readonly description: string,
  ) {}

  /** The graph identifier other nodes reference this organisation by. */
  static idFor(baseUrl: string): string {
    return `${baseUrl}/#organisation`;
  }

  emit(): Record<string, unknown> | null {
    const node: Record<string, unknown> = {
      '@type': 'Organization',
      '@id': Organisation.idFor(this.baseUrl),
      name: this.name,
      url: `${this.baseUrl}/`,
    };

    if (this.description.trim() !== '') {
      node.description = this.description;
    }

    return node;
  }
}

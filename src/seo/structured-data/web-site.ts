import { Emitter } from './emitter';
import { Organisation } from './organisation';

/**
 * Ported from storefront-lamp/core/Seo/StructuredData/WebSite.php. The storefront itself, as
 * schema.org `WebSite` with a search action (`[24.8]`).
 *
 * The search action is conditional on a target being supplied — a deployment whose listing endpoint
 * does not read a query parameter can suppress the action entirely by naming no target, rather than
 * publishing a promise it does not keep.
 */
export class WebSite implements Emitter {
  /** schema.org's placeholder for the submitted query, substituted by the consumer. */
  static readonly QUERY_PLACEHOLDER = '{search_term_string}';

  constructor(
    private readonly baseUrl: string,
    private readonly name: string,
    private readonly searchUrlTemplate: string | null = null,
    private readonly hasPublisher: boolean = false,
  ) {}

  /** The graph identifier other nodes reference this site by. */
  static idFor(baseUrl: string): string {
    return `${baseUrl}/#website`;
  }

  emit(): Record<string, unknown> | null {
    const node: Record<string, unknown> = {
      '@type': 'WebSite',
      '@id': WebSite.idFor(this.baseUrl),
      name: this.name,
      url: `${this.baseUrl}/`,
    };

    // Only when the organisation node is actually in the graph: a reference to an `@id` nothing
    // defines is a dangling pointer.
    if (this.hasPublisher) {
      node.publisher = { '@id': Organisation.idFor(this.baseUrl) };
    }

    const target = this.searchTarget();
    if (target !== null) {
      node.potentialAction = {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: target },
        'query-input': 'required name=search_term_string',
      };
    }

    return node;
  }

  /** The absolute search URL template, or null when the deployment named none or named one with no place to put the query. */
  private searchTarget(): string | null {
    const template = (this.searchUrlTemplate ?? '').trim();
    if (template === '' || !template.includes(WebSite.QUERY_PLACEHOLDER)) return null;

    if (template.startsWith('http://') || template.startsWith('https://')) return template;

    return `${this.baseUrl}/${template.replace(/^\/+/, '')}`;
  }
}

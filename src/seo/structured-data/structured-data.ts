import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../../config/app';
import { CatalogProvider } from '../../catalog/catalog-provider';
import { CatalogProduct } from '../../domain/product-catalog';
import { ConfigService } from '../../support/config';
import { Url } from '../../support/url';
import { MetaResolver } from '../meta-resolver';
import { BreadcrumbList, Crumb } from './breadcrumb-list';
import { Emitter } from './emitter';
import { Organisation } from './organisation';
import { Product } from './product';
import { WebSite } from './web-site';

const LISTING_PATH = '/treatments/';
const LISTING_LABEL = 'Treatments';
const ROOT_LABEL = 'Home';
const DEFAULT_SEARCH_TEMPLATE = `/treatments/?q=${WebSite.QUERY_PLACEHOLDER}`;

/**
 * Ported from storefront-lamp/core/Seo/StructuredData/StructuredData.php. Assembles the schema.org
 * graph a given path publishes (`[24.8]`).
 *
 * Every emitter is independently switchable in `config.app.seo.structuredData`, and each toggle
 * defaults to **off** when unset — a deployment that has not configured structured data publishes
 * none rather than publishing whatever the catalog happens to contain.
 *
 * The graph is assembled from the path, the same input `RobotsPolicy` decides indexing from, but is
 * deliberately *not* gated on indexability — `[24.7]`'s master switch is about what a crawler may
 * index, not about what the page says about itself.
 */
@Injectable()
export class StructuredData {
  constructor(
    private readonly config: ConfigService,
    private readonly catalog: CatalogProvider,
    private readonly meta: MetaResolver,
  ) {}

  /** Every node `path` publishes, in graph order. */
  nodesFor(path: string): Array<Record<string, unknown>> {
    const canonicalPath = Url.canonicalizePath(path);

    const nodes: Array<Record<string, unknown>> = [];
    for (const emitter of this.emittersFor(canonicalPath)) {
      const node = emitter.emit();
      if (node !== null) nodes.push(node);
    }

    return nodes;
  }

  /**
   * The `application/ld+json` document for `path`, or **null when there is nothing to publish** —
   * so the template can omit the `<script>` element entirely. `<` and `&` are escaped so no catalog
   * string can close the script element it is embedded in.
   */
  json(path: string): string | null {
    const nodes = this.nodesFor(path);
    if (nodes.length === 0) return null;

    const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes });
    return json.replace(/</g, '\\u003C').replace(/&/g, '\\u0026');
  }

  private emittersFor(path: string): Emitter[] {
    const base = this.baseUrl();
    const organisation = this.enabled('organisation');

    const emitters: Emitter[] = [];

    if (organisation) {
      emitters.push(new Organisation(base, this.meta.siteName(), this.meta.description()));
    }

    if (this.enabled('website')) {
      emitters.push(new WebSite(base, this.meta.siteName(), this.searchUrlTemplate(), organisation));
    }

    const product = this.productFor(path);
    if (product === null) {
      if (path === LISTING_PATH && this.enabled('breadcrumbs')) {
        emitters.push(new BreadcrumbList(this.trail()));
      }
      return emitters;
    }

    const node = this.productEmitter(product, path);

    // `[24.10]`: when a prescription product publishes nothing, its breadcrumb trail publishes
    // nothing either — the last crumb would restate exactly what the omission withheld.
    if (node.emit() === null) {
      return emitters;
    }

    if (this.enabled('product')) {
      emitters.push(node);
    }

    if (this.enabled('breadcrumbs')) {
      emitters.push(new BreadcrumbList([...this.trail(), { name: (product.name ?? '').trim(), url: this.meta.canonical(path) }]));
    }

    return emitters;
  }

  private productEmitter(product: CatalogProduct, path: string): Product {
    return new Product(product, this.meta.canonical(path), this.baseUrl(), this.meta.description(product.description ?? null), this.meta.siteName(), this.currency(), this.enabled('rx'));
  }

  private trail(): Crumb[] {
    return [
      { name: ROOT_LABEL, url: `${this.baseUrl()}/` },
      { name: LISTING_LABEL, url: this.meta.canonical(LISTING_PATH) },
    ];
  }

  private productFor(path: string): CatalogProduct | null {
    const match = /^\/products\/([^/]+)\/$/.exec(path);
    if (match === null) return null;
    return this.catalog.product(match[1]);
  }

  /** The catalog channel's currency, or null when it names none — an offer priced in a guessed currency would disagree with the checkout. */
  private currency(): string | null {
    const currency = (this.catalog.channel().currency ?? '').trim();
    return currency === '' ? null : currency.toUpperCase();
  }

  private searchUrlTemplate(): string | null {
    const template = this.config.app.seo.searchUrlTemplate ?? DEFAULT_SEARCH_TEMPLATE;
    return template.trim() !== '' ? template.trim() : null;
  }

  private baseUrl(): string {
    return this.config.app.url.replace(/\/+$/, '');
  }

  /** Absent means off: an unconfigured deployment publishes nothing. */
  private enabled(emitter: keyof AppConfig['seo']['structuredData']): boolean {
    return this.config.app.seo.structuredData[emitter] === true;
  }
}

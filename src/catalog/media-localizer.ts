import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CatalogProduct } from '../domain/product-catalog';
import { BuiltCatalog } from './catalog-builder';

const FALLBACK_PLACEHOLDER = '/assets/img/product-placeholder.svg';
const DEFAULT_EXTENSION = 'png';

export interface MediaReport {
  downloaded: number;
  unchanged: number;
  failed: string[];
  orphaned: string[];
}

export interface LocalizeResult {
  catalog: BuiltCatalog;
  report: MediaReport;
}

/**
 * Ported from storefront-lamp/core/Catalog/MediaLocalizer.php. Downloads each product's
 * `remote_image` into `public/assets/media/` (content-hashed filenames so a re-run only
 * re-downloads what actually changed [3.10]) and rewrites the product's `image`/`gallery[0]` to
 * point at the local copy. Uses Node's global `fetch` rather than any SDK client, matching the PHP
 * original's own "SDK-free by design" choice — a caller resolves `assetBaseUrl` itself.
 *
 * A single image failure (a non-2xx response or a thrown fetch error) never aborts the run [3.3]:
 * the affected product falls back to its newest already-downloaded local file, or the shared
 * placeholder SVG when it has none, and its slug is recorded in the report's `failed` list.
 */
export class MediaLocalizer {
  constructor(
    private readonly mediaDir: string,
    private readonly assetBaseUrl: string,
  ) {}

  async localize(catalog: BuiltCatalog): Promise<LocalizeResult> {
    this.ensureMediaDir();

    let downloaded = 0;
    let unchanged = 0;
    const failed: string[] = [];
    const catalogSlugs: string[] = [];

    const products: Record<string, CatalogProduct> = { ...catalog.products };

    for (const [key, product] of Object.entries(products)) {
      const slug = product.slug ?? key;
      catalogSlugs.push(slug);

      const remoteImage = product.remote_image ?? null;
      if (remoteImage === null) continue;

      const outcome = await this.localizeOne(slug, remoteImage);

      if (outcome.status === 'downloaded') downloaded += 1;
      else if (outcome.status === 'unchanged') unchanged += 1;
      else failed.push(slug);

      const gallery = Array.isArray(product.gallery) ? [...product.gallery] : [];
      gallery[0] = outcome.path;

      products[key] = { ...product, image: outcome.path, gallery };
    }

    return {
      catalog: { ...catalog, products },
      report: { downloaded, unchanged, failed, orphaned: MediaLocalizer.findOrphans(this.mediaDir, catalogSlugs) },
    };
  }

  /**
   * Files in `mediaDir` whose slug prefix (the portion of the filename before its first `.`)
   * matches none of `catalogSlugs` — shared between `localize()` (report-only) and `media:prune`
   * (report + optional delete), so both agree on exactly what counts as an orphan.
   */
  static findOrphans(mediaDir: string, catalogSlugs: string[]): string[] {
    if (!existsSync(mediaDir)) return [];

    const slugSet = new Set(catalogSlugs);
    const orphans: string[] = [];

    for (const basename of readdirSync(mediaDir)) {
      const path = join(mediaDir, basename);
      if (!statSync(path).isFile()) continue;

      const dotIndex = basename.indexOf('.');
      const slug = dotIndex === -1 ? basename : basename.slice(0, dotIndex);

      if (!slugSet.has(slug)) orphans.push(basename);
    }

    return orphans.sort();
  }

  private async localizeOne(slug: string, remoteImage: string): Promise<{ status: 'downloaded' | 'unchanged' | 'failed'; path: string }> {
    const existingFiles = existsSync(this.mediaDir)
      ? readdirSync(this.mediaDir)
          .filter((name) => name.startsWith(`${slug}.`))
          .map((name) => join(this.mediaDir, name))
      : [];

    let response: Response;
    try {
      response = await fetch(this.joinUrl(remoteImage));
    } catch {
      return this.fallback(existingFiles);
    }

    if (!response.ok) {
      return this.fallback(existingFiles);
    }

    const body = Buffer.from(await response.arrayBuffer());
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 8);
    const filename = `${slug}.${hash}.${MediaLocalizer.extensionOf(remoteImage)}`;
    const path = join(this.mediaDir, filename);

    if (existsSync(path)) {
      return { status: 'unchanged', path: `/assets/media/${filename}` };
    }

    writeFileSync(path, body);
    return { status: 'downloaded', path: `/assets/media/${filename}` };
  }

  private fallback(existingFiles: string[]): { status: 'failed'; path: string } {
    if (existingFiles.length === 0) {
      return { status: 'failed', path: FALLBACK_PLACEHOLDER };
    }

    const newest = [...existingFiles].sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    return { status: 'failed', path: `/assets/media/${newest.split('/').pop()}` };
  }

  private joinUrl(remoteImage: string): string {
    return `${this.assetBaseUrl.replace(/\/+$/, '')}/${remoteImage.replace(/^\/+/, '')}`;
  }

  private static extensionOf(remoteImage: string): string {
    let pathname = remoteImage;
    try {
      pathname = new URL(remoteImage).pathname;
    } catch {
      // Not an absolute URL — treat the whole string as a path.
    }

    const match = /\.([a-zA-Z0-9]+)$/.exec(pathname);
    return match ? match[1].toLowerCase() : DEFAULT_EXTENSION;
  }

  private ensureMediaDir(): void {
    if (!existsSync(this.mediaDir)) {
      mkdirSync(this.mediaDir, { recursive: true, mode: 0o775 });
    }
  }
}

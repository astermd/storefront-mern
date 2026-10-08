import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BuiltCatalog } from './catalog-builder';

type JsonRecord = Record<string, unknown>;

/**
 * Ported from storefront-lamp/core/Support/PhpArrayExporter.php and the merge logic embedded in
 * `core/Console/SyncCommand.php`. Renders the two generated config files `theme:sync` writes, and
 * merges a fresh channel payload onto whatever `config/channel.generated.ts` already holds.
 *
 * **A deliberate divergence from `PhpArrayExporter`'s hand-rolled recursive renderer**: this port's
 * generated files are TypeScript modules, not PHP array literals, and `JSON.stringify(value, null,
 * 2)` is already valid TypeScript object-literal syntax (JSON is a syntactic subset of it) — there
 * is no PHP-style `serialize_precision`/list-vs-map distinction to reproduce, so a hand-rolled
 * renderer would just be re-implementing what `JSON.stringify` already does correctly. No unified
 * diff is produced either (`PhpArrayExporter::unifiedDiff()`'s human-review convenience) — a
 * dry-run instead reports a would-change boolean and the key counts that changed, which is enough
 * for an operator to decide whether to `--apply`.
 */
export class GeneratedConfigWriter {
  /** `products.generated.ts` — overwritten wholesale on every sync, never merged. */
  static renderProductsModule(catalog: BuiltCatalog, header: string): string {
    return [
      GeneratedConfigWriter.headerComment(header),
      "import { CatalogProduct } from '../src/domain/product-catalog';",
      '',
      'export interface GeneratedCatalog {',
      '  channel: { id: string; name: string; currency: string };',
      '  products: Record<string, CatalogProduct>;',
      '}',
      '',
      `export const productsGenerated: GeneratedCatalog = ${JSON.stringify(catalog, null, 2)};`,
      '',
    ].join('\n');
  }

  /** `channel.generated.ts` — merged onto whatever is already on disk (see `mergeOntoExisting`). */
  static renderChannelModule(payload: JsonRecord, header: string): string {
    return [
      GeneratedConfigWriter.headerComment(header),
      'export interface GeneratedChannelConfig {',
      '  channel: { id: string | null; name: string | null };',
      '  payment_processor: { provider_category: string | null; name: string | null; config: Record<string, unknown> };',
      '}',
      '',
      `export const channelGenerated: GeneratedChannelConfig = ${JSON.stringify(payload, null, 2)};`,
      '',
    ].join('\n');
  }

  private static headerComment(header: string): string {
    const lines = header.split('\n').map((line) => (line === '' ? ' *' : ` * ${line}`));
    return `/**\n${lines.join('\n')}\n */\n`;
  }

  /**
   * The channel payload `theme:sync` builds from a fresh Channel Details response — `channelPayload()`
   * in the PHP original.
   */
  static channelPayload(data: JsonRecord): JsonRecord {
    const paymentProcessor = (data.payment_processor && typeof data.payment_processor === 'object' ? data.payment_processor : {}) as JsonRecord;
    const config = paymentProcessor.config && typeof paymentProcessor.config === 'object' ? paymentProcessor.config : {};

    return {
      channel: { id: data._id ?? null, name: data.name ?? null },
      payment_processor: {
        provider_category: paymentProcessor.provider_category ?? null,
        name: paymentProcessor.name ?? null,
        config,
      },
    };
  }

  /**
   * Reads whatever `config/channel.generated.ts` currently exports, via the last build's compiled
   * output — a sync writes source `theme:sync` will re-read only after the app is rebuilt, exactly
   * the same "rebuild to take effect" reality `products.generated.ts` already lives with. Returns
   * `{}` (treated as "no file yet") when nothing has been built, matching `PhpArrayExporter`'s own
   * PHP original's `is_file()` guard.
   */
  static readExistingChannelPayload(): JsonRecord {
    const compiledPath = join(process.cwd(), 'dist/config/channel.generated.js');
    if (!existsSync(compiledPath)) return {};

    try {
      // Reading the last build's compiled output is the only way to see what a previous sync
      // actually wrote; see this method's doc comment.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(compiledPath) as { channelGenerated?: JsonRecord };
      return mod.channelGenerated && typeof mod.channelGenerated === 'object' ? mod.channelGenerated : {};
    } catch {
      return {};
    }
  }

  /**
   * `mergeOntoExisting`: if there's no existing file, or the channel identity changed, the new
   * payload replaces the file wholesale — a different deployment target, and nothing in the old
   * file describes it. Otherwise merge-keep-extra, then force-overwrite `payment_processor` with
   * the fresh payload's — every key in it is one provider's own generated vocabulary, and merging
   * it can only ever preserve a credential belonging to a provider this deployment no longer talks
   * to.
   */
  static mergeOntoExisting(existing: JsonRecord, next: JsonRecord): JsonRecord {
    if (Object.keys(existing).length === 0 || GeneratedConfigWriter.identity(existing) !== GeneratedConfigWriter.identity(next)) {
      return next;
    }

    const merged = GeneratedConfigWriter.mergeKeepExtra(existing, next);
    merged.payment_processor = next.payment_processor ?? {};
    return merged;
  }

  /** The channel this payload describes, as a comparable string — an absent id is `''`, not null, so "predates the key" and "says it's empty" compare equal. */
  private static identity(payload: JsonRecord): string {
    const channel = (payload.channel && typeof payload.channel === 'object' ? payload.channel : {}) as JsonRecord;
    const id = channel.id;
    return typeof id === 'string' || typeof id === 'number' || typeof id === 'boolean' ? String(id).trim() : '';
  }

  /** Recursive union: keys present only in `existing` survive; keys in `next` win, recursing when both sides hold an object. */
  private static mergeKeepExtra(existing: JsonRecord, next: JsonRecord): JsonRecord {
    const merged: JsonRecord = { ...existing };

    for (const [key, value] of Object.entries(next)) {
      const currentValue = merged[key];
      merged[key] =
        value && typeof value === 'object' && !Array.isArray(value) && currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)
          ? GeneratedConfigWriter.mergeKeepExtra(currentValue as JsonRecord, value as JsonRecord)
          : value;
    }

    return merged;
  }
}

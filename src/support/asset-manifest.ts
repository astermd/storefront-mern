import { readFileSync } from 'node:fs';

/**
 * Ported from storefront-lamp/core/Support/AssetManifest.php. Maps a logical asset name (e.g.
 * `script.js`) to its content-hashed build output (e.g. `script.8d796604.js`) via the build's
 * manifest.json, so templates never hardcode a hash that changes on every rebuild. Read once and
 * cached in-process for the life of the process (Node has no per-request process boundary the way
 * PHP-FPM does, so "once" here means "once per app instance," not "once per request").
 *
 * If the manifest is missing or unreadable, or has no entry for the requested name, `resolve()`
 * falls back to the logical name itself rather than throwing — templates keep rendering (with an
 * unhashed, possibly uncached asset URL) instead of a build hiccup taking the whole page down.
 */
export class AssetManifest {
  private entries: Record<string, string> | null = null;

  constructor(private readonly manifestPath: string) {}

  resolve(logicalName: string): string {
    if (this.entries === null) {
      this.entries = this.load();
    }

    return `/assets/build/${this.entries[logicalName] ?? logicalName}`;
  }

  private load(): Record<string, string> {
    try {
      const raw = readFileSync(this.manifestPath, 'utf8');
      const decoded: unknown = JSON.parse(raw);
      return decoded && typeof decoded === 'object' ? (decoded as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
}

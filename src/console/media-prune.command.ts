import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Command, CommandRunner, Option } from 'nest-commander';
import { CatalogProvider } from '../catalog/catalog-provider';
import { MediaLocalizer } from '../catalog/media-localizer';

interface MediaPruneOptions {
  force?: boolean;
}

/**
 * Ported from storefront-lamp/core/Console/MediaPruneCommand.php. `media:prune` — lists (or, with
 * `--force`, deletes) files under `public/assets/media` that `MediaLocalizer` wrote for a product
 * no longer in the synced catalog.
 *
 * An orphan is a file whose slug prefix (the portion of its basename before the first `.`) matches
 * none of the current catalog's product slugs — the same predicate `MediaLocalizer.localize()`
 * itself uses to report orphans in its own run, via the shared `findOrphans()`. A still-live
 * product's stale fallback file is intentionally NOT an orphan by this rule: `MediaLocalizer`'s own
 * failure-fallback ladder depends on an old, still-slug-matching file surviving so a transient
 * download failure has something to fall back to.
 */
@Command({ name: 'media:prune', description: 'List (or, with --force, delete) orphaned files in public/assets/media' })
export class MediaPruneCommand extends CommandRunner {
  constructor(private readonly catalog: CatalogProvider) {
    super();
  }

  @Option({ flags: '--force', description: 'Delete orphaned files instead of just listing them' })
  parseForce(): boolean {
    return true;
  }

  run(_params: string[], options: MediaPruneOptions): Promise<void> {
    const mediaDir = join(process.cwd(), 'public/assets/media');
    const slugs = this.catalog.products().map((product) => product.slug);
    const orphans = MediaLocalizer.findOrphans(mediaDir, slugs);

    if (orphans.length === 0) {
      console.log('No orphaned media files.');
      return Promise.resolve();
    }

    for (const orphan of orphans) {
      console.log(orphan);
      if (options.force === true) {
        try {
          unlinkSync(join(mediaDir, orphan));
        } catch {
          // Silently suppressed, matching the PHP original's @unlink — a file that resists
          // deletion is reported by its continued presence on the next run, not by a failure here.
        }
      }
    }

    if (options.force !== true) {
      console.log('(dry run — use --force to delete)');
    }

    return Promise.resolve();
  }
}

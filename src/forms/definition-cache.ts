import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { globSync } from 'node:fs';

/**
 * Ported from storefront-lamp/core/Forms/DefinitionCache.php. The server-side definition cache
 * (`[3.11]`) closes `[3.6]` with: a form definition is otherwise fetched from a signed remote URL
 * on every request that renders a form, which puts a third-party round trip on the critical path
 * of the highest-abandonment step in the funnel.
 *
 * The key is the teleform's `form_json_identifier`, which carries the form's version and publish
 * timestamp. That makes republishing a form a cache miss on its own, so there is no invalidation to
 * get wrong (`[3.12]`) — the TTL is only a backstop for a definition nobody republished but which
 * should be re-read anyway. The identifier is a path (`account/org/slug_v_epoch.json`), so it is
 * hashed rather than used as a filename: it contains separators, and a value that reached the
 * filesystem verbatim would be a traversal.
 */
export class DefinitionCache {
  constructor(
    private readonly directory: string,
    private readonly ttlSeconds: number,
  ) {}

  get(identifier: string): Record<string, unknown> | null {
    const path = this.pathFor(identifier);
    if (!existsSync(path)) return null;

    const age = (Date.now() - statSync(path).mtimeMs) / 1000;
    if (this.ttlSeconds > 0 && age > this.ttlSeconds) return null;

    try {
      const decoded = JSON.parse(readFileSync(path, 'utf8'));
      return decoded && typeof decoded === 'object' ? decoded : null;
    } catch {
      return null;
    }
  }

  put(identifier: string, definition: Record<string, unknown>): void {
    try {
      mkdirSync(this.directory, { recursive: true });
    } catch {
      return;
    }

    let encoded: string;
    try {
      encoded = JSON.stringify(definition);
    } catch {
      return;
    }

    // Written via a temp file in the same directory and renamed, so a concurrent reader never
    // sees a half-written definition.
    const path = this.pathFor(identifier);
    const temp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      writeFileSync(temp, encoded);
      renameSync(temp, path);
    } catch {
      try {
        unlinkSync(temp);
      } catch {
        // Already gone.
      }
    }
  }

  /** How many cached definitions were removed, for the operator command's output. */
  purge(): number {
    let removed = 0;
    const files = [...globSync(join(this.directory, '*.json')), ...globSync(join(this.directory, '*.tmp'))];
    for (const file of files) {
      try {
        unlinkSync(file);
        removed++;
      } catch {
        // Already gone.
      }
    }
    return removed;
  }

  /**
   * What the health endpoint reports about this cache (`[20.15]`).
   *
   * **Writable is not the same as present.** A missing directory is the ordinary state of a
   * freshly deployed instance and is created on the first write, so what is asked is whether that
   * write could succeed — the directory if it exists, and otherwise the nearest ancestor that does.
   */
  state(): { writable: boolean; entries: number } {
    return {
      writable: DefinitionCache.isWritable(DefinitionCache.nearestExistingAncestor(this.directory)),
      entries: existsSync(this.directory) ? globSync(join(this.directory, '*.json')).length : 0,
    };
  }

  private static nearestExistingAncestor(path: string): string {
    let current = path;
    while (!existsSync(current)) {
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
    return current;
  }

  private static isWritable(path: string): boolean {
    try {
      const probe = join(path, `.write-probe-${randomBytes(4).toString('hex')}`);
      writeFileSync(probe, '');
      unlinkSync(probe);
      return true;
    } catch {
      return false;
    }
  }

  private pathFor(identifier: string): string {
    return join(this.directory, `${createHash('sha256').update(identifier).digest('hex')}.json`);
  }
}

import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { LogDirectoryUnreadable } from './log-directory-unreadable';

/**
 * Ported from storefront-lamp/core/Retention/LogSweep.php. `[30.6]`'s third category: the files
 * under `storage/logs/`.
 *
 * The rule names debug logs alongside sessions and events, and `[30.9]` insists deletion reaches the
 * copies that are easy to forget. A deployment that ever turned on wire logging has verbatim card
 * and identity payloads sitting on disk with nothing else scheduled to remove them.
 *
 * **Age is the file's own modification time**, not a date parsed out of its name. `app.log` is not
 * named by anything, and a file still being appended to right now — the one holding today's
 * payloads — must stay outside the policy; one nothing has touched since its period expired is in.
 *
 * **Only regular files directly inside the directory.** Directories are left alone, and dotfiles are
 * skipped.
 *
 * **A missing directory is not a failure; an unlistable one is.** A deployment that has never
 * written a log and one whose directory an operator removed both have nothing to expire. A directory
 * that is *there* and cannot be opened is the opposite state wearing the same clothes —
 * `LogDirectoryUnreadable` says why the difference is worth a type.
 */
export class LogSweep {
  constructor(private readonly directory: string) {}

  /**
   * How many files `expire()` would take, without taking them. Shares that method's candidate list,
   * so the dry run and the delete cannot describe different sweeps.
   */
  countExpirable(modifiedBefore: string): number {
    return this.expirable(modifiedBefore).length;
  }

  /** @returns files deleted — a file the filesystem refuses to unlink is not counted. */
  expire(modifiedBefore: string): number {
    let deleted = 0;

    for (const path of this.expirable(modifiedBefore)) {
      try {
        unlinkSync(path);
        deleted += 1;
      } catch {
        // Not counted — see the class docblock.
      }
    }

    return deleted;
  }

  /**
   * The files old enough to take. A cutoff that cannot be parsed yields no candidates, which fails
   * closed: the run reports zero rather than treating "unknown" as "everything".
   */
  private expirable(modifiedBefore: string): string[] {
    const cutoff = Date.parse(modifiedBefore);
    if (Number.isNaN(cutoff) || !existsSync(this.directory) || !statSync(this.directory).isDirectory()) {
      return [];
    }

    let entries: string[];
    try {
      entries = readdirSync(this.directory);
    } catch {
      throw LogDirectoryUnreadable.at(this.directory);
    }

    const expirable: string[] = [];

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;

      const path = join(this.directory, entry);

      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }

      if (!stat.isFile()) continue;

      if (stat.mtimeMs < cutoff) {
        expirable.push(path);
      }
    }

    return expirable;
  }
}

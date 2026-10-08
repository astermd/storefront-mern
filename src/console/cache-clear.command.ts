import { existsSync, mkdirSync, readdirSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Command, CommandRunner } from 'nest-commander';

const CACHE_DIR = join(process.cwd(), 'storage/cache');

/**
 * Ported from storefront-lamp/core/Console/CacheClearCommand.php. `cache:clear` — wipes the
 * `storage/cache` directory's contents.
 *
 * A missing directory is treated as already-cleared, not an error — it is created and the count is
 * reported as zero. Otherwise the tree is walked child-first so a directory empties before it is
 * itself removed, and only what was *actually deleted* is counted: a permissions mismatch between
 * whatever process wrote a file and the shell user running this command must surface as a failure,
 * never as a silently-inflated success count.
 *
 * Exit code 0 when nothing survived. Exit code 1 when one or more entries could not be removed — the
 * cache was not fully cleared, and whatever it was holding is still being served.
 */
@Command({ name: 'cache:clear', description: 'Wipe the storage cache directory contents' })
export class CacheClearCommand extends CommandRunner {
  run(): Promise<void> {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
      console.log('Cache cleared (0 entries removed).');
      return Promise.resolve();
    }

    const survived: string[] = [];
    const removed = CacheClearCommand.wipe(CACHE_DIR, survived);

    if (survived.length === 0) {
      console.log(`Cache cleared (${removed} entries removed).`);
      return Promise.resolve();
    }

    console.error(`ERROR: ${survived.length} cache entr${survived.length === 1 ? 'y' : 'ies'} could not be removed:`);
    for (const path of survived) console.error(`  ${path}`);
    console.error('The cache was NOT fully cleared. Whatever it was holding is still being served.');
    process.exitCode = 1;
    return Promise.resolve();
  }

  /** Walks `dir` child-first, deleting files and then the now-empty directories beneath it. Returns the count actually removed. */
  private static wipe(dir: string, survived: string[]): number {
    let removed = 0;

    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      let isDirectory: boolean;
      try {
        isDirectory = statSync(path).isDirectory();
      } catch {
        survived.push(path);
        continue;
      }

      if (isDirectory) {
        removed += CacheClearCommand.wipe(path, survived);
        try {
          rmdirSync(path);
        } catch {
          survived.push(path);
        }
        continue;
      }

      try {
        unlinkSync(path);
        removed += 1;
      } catch {
        survived.push(path);
      }
    }

    return removed;
  }
}

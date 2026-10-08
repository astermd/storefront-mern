import { Command, CommandRunner } from 'nest-commander';
import { DefinitionCache } from '../forms/definition-cache';

/**
 * Ported from storefront-lamp/core/Console/FormsCachePurgeCommand.php. `forms:cache-purge` —
 * removes every cached teleform definition.
 *
 * A thin wrapper: `DefinitionCache.purge()` already does the work. Always exits 0 — an empty cache
 * is success, not failure (`[9.2]`), and there is no failure path in this command at all.
 */
@Command({ name: 'forms:cache-purge', description: 'Remove every cached teleform definition' })
export class FormsCachePurgeCommand extends CommandRunner {
  constructor(private readonly cache: DefinitionCache) {
    super();
  }

  run(): Promise<void> {
    const removed = this.cache.purge();
    console.log(`Teleform cache purged (${removed} definitions removed).`);
    return Promise.resolve();
  }
}

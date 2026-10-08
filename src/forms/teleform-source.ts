import { Inject, Injectable, Scope } from '@nestjs/common';
import { TELEFORM_GATEWAY } from '../core/tokens';
import { OperatorLog } from '../support/operator-log';
import { DefinitionCache } from './definition-cache';
import { FormUnavailable } from './form-unavailable';
import { TeleformGateway } from './teleform-gateway';
import { TeleformMetadata } from './teleform-metadata';

/**
 * Ported from storefront-lamp/core/Forms/TeleformSource.php. The one entry point for "give me this
 * product's form".
 *
 * Resolution is an indirection (`[10.1]`): the teleform's metadata carries a content identifier,
 * and that identifier resolves to the definition. Both hops are needed on a cache miss and only the
 * first on a hit, because the identifier *is* the cache key — it carries the form's version and
 * publish time, so a republished form misses without any invalidation step (`[3.12]`).
 *
 * The degradation rule is `[3.11]`'s: a fetch failure with a warm cache serves the cached copy, and
 * only a miss *and* a failure produces the unavailable state.
 *
 * `Scope.REQUEST` — the metadata memoization below is per-request in the PHP original (a plain
 * instance property), and Nest's default singleton scope would leak one visitor's metadata lookup
 * into another's.
 */
@Injectable({ scope: Scope.REQUEST })
export class TeleformSource {
  /** Resolved metadata, memoised per request so one page render is one read. */
  private readonly metadata = new Map<string, TeleformMetadata>();

  constructor(
    @Inject(TELEFORM_GATEWAY) private readonly gateway: TeleformGateway,
    private readonly cache: DefinitionCache,
    private readonly log: OperatorLog,
  ) {}

  async metadataFor(teleformId: string): Promise<TeleformMetadata | null> {
    const cached = this.metadata.get(teleformId);
    if (cached) return cached;

    const metadata = await this.gateway.metadata(teleformId);
    if (metadata !== null) {
      this.metadata.set(teleformId, metadata);
    }
    return metadata;
  }

  /** @throws {FormUnavailable} when the definition is neither cached nor fetchable */
  async definitionFor(teleformId: string): Promise<Record<string, unknown>> {
    const metadata = await this.metadataFor(teleformId);
    if (metadata === null) {
      this.log.warning('intake.teleform_metadata_unavailable', { teleform: teleformId });
      throw new FormUnavailable(`No teleform metadata for "${teleformId}".`);
    }

    const cached = this.cache.get(metadata.identifier);
    if (cached !== null) return cached;

    const definition = await this.gateway.definition(metadata);
    if (definition === null) {
      this.log.warning('intake.definition_unavailable', { teleform: teleformId, identifier: metadata.identifier });
      throw new FormUnavailable(`No definition for teleform "${teleformId}".`);
    }

    this.cache.put(metadata.identifier, definition);
    return definition;
  }
}

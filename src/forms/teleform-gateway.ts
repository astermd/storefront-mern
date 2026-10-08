import { TeleformMetadata } from './teleform-metadata';

/**
 * Ported from storefront-lamp/core/Forms/TeleformGateway.php. The storefront's view of the EMR's
 * teleform resource, split in two because the two halves fail differently and are cached
 * differently: the metadata is a cheap authenticated read that yields the cache key, and the
 * definition is a large document behind a short-lived signed URL.
 */
export interface TeleformGateway {
  metadata(teleformId: string): Promise<TeleformMetadata | null>;

  /** The decoded definition, or null when it could not be fetched. */
  definition(metadata: TeleformMetadata): Promise<Record<string, unknown> | null>;
}

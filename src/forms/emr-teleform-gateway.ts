import { Injectable } from '@nestjs/common';
import { ApiError } from '@astermd-hq/sdk';
import { EmrClientFactory } from '../emr/client-factory';
import { OperatorLog } from '../support/operator-log';
import { TeleformGateway } from './teleform-gateway';
import { TeleformMetadata } from './teleform-metadata';

/** Keys an envelope may carry the definition under, when it isn't the envelope itself. */
const INLINE_KEYS = ['pages', 'form', 'definition', 'form_json', 'data'];

/** Ported from storefront-lamp/core/Forms/EmrTeleformGateway.php's fetch timeout. */
const FETCH_TIMEOUT_MS = 10_000;

function isDefinitionShaped(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Array.isArray((value as Record<string, unknown>).pages);
}

/**
 * Ported from storefront-lamp/core/Forms/EmrTeleformGateway.php. {@link TeleformGateway} over the
 * SDK's `teleforms()` resource.
 *
 * `metadata()` is a cheap authenticated read. `definition()` is a large document behind a
 * short-lived signed URL: the envelope either carries the definition inline (checked under several
 * candidate keys, since the shape isn't guaranteed) or names a `view_url` this class fetches with a
 * plain HTTPS GET — deliberately outside the SDK's own authenticated transport, since the URL is
 * itself pre-signed.
 */
@Injectable()
export class EmrTeleformGateway implements TeleformGateway {
  constructor(
    private readonly clients: EmrClientFactory,
    private readonly log: OperatorLog,
  ) {}

  async metadata(teleformId: string): Promise<TeleformMetadata | null> {
    try {
      const response = await this.clients.create().teleforms().view(teleformId);
      return TeleformMetadata.fromPayload(teleformId, response.data() as Record<string, unknown>);
    } catch (e) {
      this.log.warning('intake.teleform_view_failed', {
        teleform: teleformId,
        exception: (e as Error).constructor.name,
        status: e instanceof ApiError ? e.statusCode() : null,
      });
      return null;
    }
  }

  async definition(metadata: TeleformMetadata): Promise<Record<string, unknown> | null> {
    let envelope: Record<string, unknown>;
    try {
      const response = await this.clients.create().teleforms().viewByIdentifier(metadata.identifier);
      envelope = response.data() as Record<string, unknown>;
    } catch (e) {
      this.log.warning('intake.teleform_identifier_failed', {
        teleform: metadata.id,
        exception: (e as Error).constructor.name,
        status: e instanceof ApiError ? e.statusCode() : null,
      });
      return null;
    }

    const inline = EmrTeleformGateway.inlineDefinition(envelope);
    if (inline !== null) return inline;

    const viewUrl = envelope.view_url;
    if (typeof viewUrl !== 'string' || viewUrl.trim() === '') {
      this.log.warning('intake.definition_shape_unrecognised', { teleform: metadata.id, envelope_keys: Object.keys(envelope) });
      return null;
    }

    return this.fetchDefinition(metadata.id, viewUrl);
  }

  private static inlineDefinition(envelope: Record<string, unknown>): Record<string, unknown> | null {
    if (isDefinitionShaped(envelope)) return envelope;

    for (const key of INLINE_KEYS) {
      const candidate = envelope[key];
      if (isDefinitionShaped(candidate)) return candidate;
    }

    return null;
  }

  private async fetchDefinition(teleformId: string, url: string): Promise<Record<string, unknown> | null> {
    let raw: string;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, { signal: controller.signal });
        raw = await res.text();
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      this.log.warning('intake.definition_fetch_failed', { teleform: teleformId });
      return null;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      decoded = null;
    }

    if (!isDefinitionShaped(decoded)) {
      this.log.warning('intake.definition_undecodable', { teleform: teleformId });
      return null;
    }

    return decoded;
  }
}

import { TeleformGateway } from '../../src/forms/teleform-gateway';
import { TeleformMetadata } from '../../src/forms/teleform-metadata';

/**
 * A test-only `TeleformGateway` backed by an in-memory fixture, unlike `NullTeleformGateway` (which
 * both methods always answer `null` under, so the live route always degrades to
 * `form-unavailable.ejs` — see STATUS.md's Phase 6 section on why the shipped example catalog can
 * never reach a populated form for real). Needed by any e2e test that must render a real
 * questionnaire page rather than only its degrade path.
 *
 * Definitions are keyed by teleform id here, but `TeleformSource`/`DefinitionCache` key the
 * *definition* by `metadata.identifier` — give each fixture a distinct identifier if a test needs
 * to prove a republished form (a changed identifier) misses the cache.
 */
export class FakeTeleformGateway implements TeleformGateway {
  private readonly metadataById = new Map<string, TeleformMetadata>();
  private readonly definitionByIdentifier = new Map<string, Record<string, unknown>>();

  register(metadata: TeleformMetadata, definition: Record<string, unknown>): this {
    this.metadataById.set(metadata.id, metadata);
    this.definitionByIdentifier.set(metadata.identifier, definition);
    return this;
  }

  async metadata(teleformId: string): Promise<TeleformMetadata | null> {
    return this.metadataById.get(teleformId) ?? null;
  }

  async definition(metadata: TeleformMetadata): Promise<Record<string, unknown> | null> {
    return this.definitionByIdentifier.get(metadata.identifier) ?? null;
  }
}

/** One page, two fields (a required name and the blocking terms checkbox), plus a submit button — enough to prove a real submit round-trip past validation and disqualification. */
export function minimalIntakeDefinition(): Record<string, unknown> {
  return {
    pages: [
      {
        pageId: 'p1',
        order: 1,
        fields: [
          { fieldId: 'first_name', name: 'first_name', type: 'text', label: 'First name', order: 1, required: true },
          { fieldId: 'consent', name: 'consent', type: 'terms', label: 'I agree to the intake terms', order: 2, required: true },
          { fieldId: 'submit_btn', name: 'submit_btn', type: 'button', label: 'Submit', order: 3, properties: { buttonAction: 'submit' } },
        ],
      },
    ],
  };
}

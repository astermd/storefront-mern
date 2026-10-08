import { TeleformGateway } from '../forms/teleform-gateway';
import { TeleformMetadata } from '../forms/teleform-metadata';
import { Boundary } from './boundary';
import { BoundaryTimer } from './boundary-timer';

/**
 * Ported from storefront-lamp/core/Observability/InstrumentedTeleformGateway.php. `[20.9]` over the
 * form-definition boundary, in both halves.
 *
 * The two halves are timed separately because they fail separately — the metadata is a cheap
 * authenticated read and the definition is a large document behind a short-lived signed URL, so a
 * rising failure rate on one says something quite different from the other. The definition itself is
 * never logged — it is the questionnaire, and its field labels are clinical.
 */
export class InstrumentedTeleformGateway implements TeleformGateway {
  constructor(
    private readonly inner: TeleformGateway,
    private readonly timer: BoundaryTimer,
  ) {}

  async metadata(teleformId: string): Promise<TeleformMetadata | null> {
    return this.timer.measure(
      Boundary.FormDefinition,
      () => this.inner.metadata(teleformId),
      (metadata) => ({ outcome: metadata === null ? 'failed' : 'ok' }),
      { operation: 'metadata', teleform: teleformId },
    );
  }

  async definition(metadata: TeleformMetadata): Promise<Record<string, unknown> | null> {
    return this.timer.measure(
      Boundary.FormDefinition,
      () => this.inner.definition(metadata),
      (definition) => ({ outcome: definition === null ? 'failed' : 'ok' }),
      { operation: 'definition', teleform: metadata.id },
    );
  }
}

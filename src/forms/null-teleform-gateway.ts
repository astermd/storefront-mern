import { Injectable } from '@nestjs/common';
import { TeleformGateway } from './teleform-gateway';
import { TeleformMetadata } from './teleform-metadata';

/**
 * Ported from storefront-lamp/core/Forms/NullTeleformGateway.php. Both methods return `null` — a
 * different degrade-shape from Cart/Session's "report success" — `null` here means "form
 * unavailable", which `TeleformSource`/`IntakeSession` turn into the `form-unavailable` page.
 */
@Injectable()
export class NullTeleformGateway implements TeleformGateway {
  async metadata(): Promise<TeleformMetadata | null> {
    return null;
  }

  async definition(): Promise<Record<string, unknown> | null> {
    return null;
  }
}

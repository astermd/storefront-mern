import { Injectable } from '@nestjs/common';
import { IntakeGateway } from './intake-gateway';

/**
 * Ported from storefront-lamp/core/Forms/NullIntakeGateway.php. `record()` always returns `true` —
 * deliberately the *opposite* choice from `NullTeleformGateway`'s `null`: a Null intake gateway
 * must look like every submission succeeded, not like recording failed.
 */
@Injectable()
export class NullIntakeGateway implements IntakeGateway {
  async record(): Promise<boolean> {
    return true;
  }

  /** `null` — no file was actually stored, unlike `record()`'s look-like-success rule; there is no reference to hand back. */
  async uploadFile(): Promise<string | null> {
    return null;
  }
}

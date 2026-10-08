import { Injectable } from '@nestjs/common';
import { IdentityGateway } from './identity-gateway';
import { IdentityVerdict } from './identity-verdict';

/**
 * Ported from storefront-lamp/core/Verification/NullIdentityGateway.php. Bound when
 * `verification.enabled` is off — its default, and always the case under the test suite.
 *
 * Always answers `inconclusive`, never `passed` — a dedicated test locks this down permanently,
 * since a Null gateway that ever let a buyer through would be indistinguishable from a real pass.
 */
@Injectable()
export class NullIdentityGateway implements IdentityGateway {
  async verify(check: string): Promise<IdentityVerdict> {
    return IdentityVerdict.inconclusive(check, 'disabled');
  }

  isEnabled(): boolean {
    return false;
  }
}

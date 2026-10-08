import { Injectable } from '@nestjs/common';
import { VerificationGateway } from './verification-gateway';

/**
 * Ported from storefront-lamp/core/Emr/NullVerificationGateway.php. Bound when
 * `features.emrVerification` is off — its default, and always the case under the test suite.
 *
 * Answers "could not determine" to everything, the same answer a live gateway gives when the
 * credential is refused, so switching the feature off changes what checkout *knows* and never
 * what it *does*.
 */
@Injectable()
export class NullVerificationGateway implements VerificationGateway {
  async emailIsDeliverable(): Promise<boolean | null> {
    return null;
  }

  async normaliseAddress(): Promise<Record<string, string> | null> {
    return null;
  }

  isEnabled(): boolean {
    return false;
  }
}

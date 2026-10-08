import { Injectable } from '@nestjs/common';
import { ApiError, IdentityCheck } from '@astermd-hq/sdk';
import { OperatorLog } from '../support/operator-log';
import { EmrClientFactory } from '../emr/client-factory';
import { IdentityGateway } from './identity-gateway';
import { IdentityVerdict } from './identity-verdict';

const VALID_CHECKS: string[] = Object.values(IdentityCheck);

/**
 * Ported from storefront-lamp/core/Verification/EmrIdentityGateway.php. {@link IdentityGateway}
 * over the SDK's `verification().verifyIdentity()` resource.
 *
 * Every failure degrades to `inconclusive` rather than throwing — a verification outage must
 * degrade the form, never the order. A 4xx `ValidationError`/`ApiError` (this storefront's own
 * payload rejected) logs at **warning**; anything else (the provider refusing the whole resource,
 * a transport failure) logs at **info** — a refusal is the expected state until a credential grant
 * lands, and an alert an operator is told to expect is one they learn to ignore.
 *
 * Nothing about the identity reaches the log — only the check, status, and coded reasons via
 * `IdentityVerdict.logContext()`.
 */
@Injectable()
export class EmrIdentityGateway implements IdentityGateway {
  constructor(
    private readonly clients: EmrClientFactory,
    private readonly log: OperatorLog,
  ) {}

  async verify(check: string, identity: Record<string, unknown>): Promise<IdentityVerdict> {
    if (!VALID_CHECKS.includes(check)) {
      this.log.warning('identity.check_unknown', { check });
      return IdentityVerdict.inconclusive(check, 'unknown_check');
    }

    let data: Record<string, unknown>;
    try {
      const response = await this.clients.create().verification().verifyIdentity(check as IdentityCheck, identity);
      data = response.data() as Record<string, unknown>;
    } catch (e) {
      if (e instanceof ApiError && e.statusCode() === 400) {
        this.log.warning('identity.request_rejected', { check, exception: e.constructor.name, status: e.statusCode() });
        return IdentityVerdict.inconclusive(check, 'request_rejected');
      }

      this.log.info('identity.unavailable', {
        check,
        exception: (e as Error).constructor.name,
        status: e instanceof ApiError ? e.statusCode() : null,
      });
      return IdentityVerdict.inconclusive(check, 'unavailable');
    }

    const verdict = IdentityVerdict.fromProviderData(check, data);
    this.log.info('identity.checked', verdict.logContext());
    return verdict;
  }

  isEnabled(): boolean {
    return true;
  }
}

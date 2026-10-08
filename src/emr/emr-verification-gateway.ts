import { Injectable } from '@nestjs/common';
import { ApiError } from '@astermd-hq/sdk';
import { OperatorLog } from '../support/operator-log';
import { EmrClientFactory } from './client-factory';
import { VerificationGateway } from './verification-gateway';

const EMAIL_VALID = 'valid';
const EMAIL_INVALID = 'invalid';

/**
 * Ported from storefront-lamp/core/Emr/EmrVerificationGateway.php. {@link VerificationGateway}
 * over the SDK's `verification()` resource.
 *
 * Bound only when `features.emrVerification` is on. Every failure here is an **info** line rather
 * than a warning — a refusal is the expected state on a credential without this grant, and an
 * alert an operator is told to expect is an alert they learn to ignore. Every exception is caught:
 * a verification outage must degrade the form, never the order.
 *
 * Nothing about the buyer reaches the log — only the exception class and status code, never the
 * message (which can quote its own input back).
 */
@Injectable()
export class EmrVerificationGateway implements VerificationGateway {
  /**
   * One answer per address, for the life of this instance's request scope — read twice (once to
   * validate the checkout form, once to say what was verified on the order that follows it), so
   * without this the buyer waits for two round trips to learn the same thing.
   */
  private readonly emailVerdicts = new Map<string, boolean | null>();

  constructor(
    private readonly clients: EmrClientFactory,
    private readonly log: OperatorLog,
  ) {}

  async emailIsDeliverable(email: string): Promise<boolean | null> {
    if (this.emailVerdicts.has(email)) {
      return this.emailVerdicts.get(email) ?? null;
    }

    let result: unknown;
    try {
      const response = await this.clients.create().verification().verifyEmail(email);
      result = (response.data() as Record<string, unknown>)['result'];
    } catch (e) {
      this.unavailable('email', e);
      this.emailVerdicts.set(email, null);
      return null;
    }

    const verdict =
      typeof result === 'string'
        ? { [EMAIL_VALID]: true, [EMAIL_INVALID]: false }[result.trim().toLowerCase()] ?? null
        : null;

    this.emailVerdicts.set(email, verdict);
    return verdict;
  }

  async normaliseAddress(address: string): Promise<Record<string, string> | null> {
    let data: Record<string, unknown>;
    try {
      const response = await this.clients.create().verification().verifyAddress(address);
      data = response.data() as Record<string, unknown>;
    } catch (e) {
      this.unavailable('address', e);
      return null;
    }

    const formatted = data['formatted_address'];
    if (data['valid'] !== true || typeof formatted !== 'string' || formatted.trim() === '') {
      return null;
    }

    return { formatted_address: formatted.trim() };
  }

  isEnabled(): boolean {
    return true;
  }

  /** Records a check that could not be run, naming which one and why, and never what was checked. */
  private unavailable(check: string, e: unknown): void {
    this.log.info('verification.unavailable', {
      check,
      exception: (e as Error).constructor.name,
      status: e instanceof ApiError ? e.statusCode() : null,
    });
  }
}

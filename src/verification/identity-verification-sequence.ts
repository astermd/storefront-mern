import { IdentityGateway } from './identity-gateway';
import { IdentityVerdict } from './identity-verdict';

export interface IdentityCheckConfig {
  slug: string;
  required: string[];
  narrowing: string[];
}

function present(value: unknown): boolean {
  return typeof value === 'string' ? value.trim() !== '' : value !== null && value !== undefined;
}

/**
 * Ported from storefront-lamp/core/Verification/IdentityVerificationSequence.php. Runs
 * `config/verification.ts`'s `checks` list against one identity, in order, until one comes back
 * decisive.
 *
 * A check whose `required` fields aren't all present is skipped entirely — never called with a
 * payload the provider would reject for missing fields the storefront already knows are missing.
 * The payload sent for a check that *does* run is trimmed to only the fields that check names
 * (`required` + `narrowing`), never the whole identity — a provider that logs its own input then
 * never sees an unrelated field.
 */
export class IdentityVerificationSequence {
  private readonly checks: IdentityCheckConfig[];

  constructor(
    private readonly gateway: IdentityGateway,
    checks: unknown[],
  ) {
    this.checks = checks
      .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
      .map((entry) => ({
        slug: typeof entry.slug === 'string' ? entry.slug : '',
        required: Array.isArray(entry.required) ? entry.required.filter((f): f is string => typeof f === 'string') : [],
        narrowing: Array.isArray(entry.narrowing) ? entry.narrowing.filter((f): f is string => typeof f === 'string') : [],
      }))
      .filter((entry) => entry.slug !== '');
  }

  async run(identity: Record<string, unknown>): Promise<IdentityVerdict> {
    let last: IdentityVerdict = IdentityVerdict.inconclusive();

    for (const check of this.checks) {
      if (!this.satisfies(check, identity)) continue;

      const verdict = await this.gateway.verify(check.slug, this.payload(check, identity));
      if (!verdict.isInconclusive()) {
        return verdict;
      }
      last = verdict;
    }

    return last;
  }

  private satisfies(check: IdentityCheckConfig, identity: Record<string, unknown>): boolean {
    return check.required.every((field) => present(identity[field]));
  }

  private payload(check: IdentityCheckConfig, identity: Record<string, unknown>): Record<string, unknown> {
    const fields = [...check.required, ...check.narrowing];
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      if (present(identity[field])) {
        out[field] = identity[field];
      }
    }
    return out;
  }
}

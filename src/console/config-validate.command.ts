import { IdentityCheck } from '@astermd-hq/sdk';
import { Command, CommandRunner } from 'nest-commander';
import { ConfigService } from '../support/config';

const IMPLEMENTED_PLACEMENTS = ['intake', 'post_checkout', 'receipt'];
const KNOWN_IDENTITY_CHECKS: readonly string[] = Object.values(IdentityCheck);

/**
 * Ported from storefront-lamp/core/Console/ValidateCommand.php. `config:validate` — checks the
 * merged configuration for mistakes the type system in this port cannot catch on its own.
 *
 * **Scoped, and deliberately so.** The PHP original validates a loosely-typed array read from disk
 * at runtime, so most of its ~1100 lines guard against a config file shaped wrong: a missing key, a
 * string where a bool belongs, a malformed `channel.generated.php`. In this port every `config/*.ts`
 * file is a TypeScript module with a typed interface — `npm run typecheck` already refuses a
 * `verification.ts` whose `enabled` is a string, or a `payment.ts` missing a required field — so an
 * entire class of the PHP original's checks is enforced by the compiler instead of by this command.
 *
 * **What is deliberately not ported, and why:** the `channel.generated.php`/payment-processor
 * required-key checks (this port has no catalog-sync pipeline to generate that file — see
 * `theme:sync`'s own doc comment); order-bump/upsell provider-mapping checks (meaningless while
 * `PAYMENT_ADAPTER` is Null-bound — every mapping would "fail" for a reason that has nothing to do
 * with a misconfigured bump); consent-link reachability (the PHP original replays the real route
 * table; this port's route table isn't introspectable outside a booted HTTP server, and a check that
 * can only ever pass would be worse than no check); structured-data/SEO-URL `problems()` sweeps and
 * the `--live` EMR product-resolution pass (no equivalent exists yet on `StructuredData`/
 * `MetaResolver`/`RobotsPolicy` in this port).
 *
 * **What is checked — the cross-file references and env-derived values a type checker cannot see:**
 * `app.debug.wireLog` left on (a live PCI/PHI violation while it runs, per `[15.8]`/`[22.21]`);
 * `abandonment.*`'s four numbers and its `marketingConsentKey` cross-reference into
 * `consent.consents`; `verification.*`'s placement/checks, when the step is enabled; `app.portal.url`
 * (warning only — the storefront still sells without a portal).
 *
 * Exit code 2 (not 1) on any error, matching the PHP original exactly. Exit 0 when there are no
 * errors, whether or not there are warnings.
 */
@Command({ name: 'config:validate', description: 'Validate the merged configuration structurally' })
export class ConfigValidateCommand extends CommandRunner {
  constructor(private readonly config: ConfigService) {
    super();
  }

  run(): Promise<void> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (this.config.app.debug.wireLog === true) {
      errors.push('app.debug.wireLog is on — every provider/EMR call is logged unredacted (card numbers, bearer tokens, SSNs, DOBs).');
    }

    this.validateAbandonment(errors);
    this.validateVerification(errors);
    this.validatePortal(warnings);

    for (const warning of warnings) console.log(`warning: ${warning}`);
    for (const error of errors) console.error(`ERROR: ${error}`);

    if (errors.length === 0) {
      if (warnings.length === 0) console.log('Configuration valid.');
      return Promise.resolve();
    }

    process.exitCode = 2;
    return Promise.resolve();
  }

  private validateAbandonment(errors: string[]): void {
    const { idleSeconds, lookbackSeconds, limit, marketingConsentKey } = this.config.abandonment;

    for (const [name, value] of [
      ['idle_seconds', idleSeconds],
      ['lookback_seconds', lookbackSeconds],
      ['limit', limit],
    ] as const) {
      if (!Number.isInteger(value) || value <= 0) {
        // Zero is what an unset env var casts to — a zero idle_seconds reports every live journey
        // as abandoned; zero lookback_seconds/limit reports none.
        errors.push(`abandonment.${name} must be a positive integer, got ${value}.`);
      }
    }

    if (marketingConsentKey.trim() === '') {
      errors.push('abandonment.marketingConsentKey must be a non-empty string.');
      return;
    }

    const knownKeys = this.config.consent.consents.map((consent) => consent.key);
    if (!knownKeys.includes(marketingConsentKey)) {
      // Every abandonment signal would report `not_asked`, including journeys that actually declined.
      errors.push(`abandonment.marketingConsentKey ('${marketingConsentKey}') does not match any configured consent key: ${knownKeys.join(', ') || '(none configured)'}.`);
    }
  }

  private validateVerification(errors: string[]): void {
    const { enabled, placement, checks } = this.config.verification;

    if (!enabled) return;

    if (!IMPLEMENTED_PLACEMENTS.includes(placement)) {
      errors.push(`verification.placement ('${placement}') is not implemented — the step would be declared but never reached. Implemented placements: ${IMPLEMENTED_PLACEMENTS.join(', ')}.`);
    }

    if (checks.length === 0) {
      errors.push('verification.checks is empty — the step would run no checks and record an inconclusive verdict for everybody.');
      return;
    }

    for (const check of checks) {
      if (!KNOWN_IDENTITY_CHECKS.includes(check.slug)) {
        errors.push(`verification check slug '${check.slug}' is not a known identity check (${KNOWN_IDENTITY_CHECKS.join(', ')}) — it would be silently dropped at runtime.`);
      }
      if (check.required.length === 0) {
        errors.push(`verification check '${check.slug}' has no required fields — the provider would 400 without them.`);
      }
    }
  }

  private validatePortal(warnings: string[]): void {
    const url = this.config.app.portal.url;

    if (url === null || url.trim() === '') {
      warnings.push("app.portal.url is not set — the header's Sign In link and the receipt's portal button will not render.");
      return;
    }

    if (!/^https?:\/\//.test(url)) {
      warnings.push(`app.portal.url ('${url}') does not start with http:// or https:// — it would resolve against this storefront itself, not the portal.`);
    }
  }
}

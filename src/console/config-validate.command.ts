import { IdentityCheck } from '@astermd-hq/sdk';
import { Inject } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';
import { CatalogProvider } from '../catalog/catalog-provider';
import { SettlementPolicy } from '../checkout/settlement-policy';
import { PAYMENT_ADAPTER } from '../core/tokens';
import { VariantPlans } from '../domain/variant-plans';
import { CheckoutChampAuthorizeMode } from '../payment/checkout-champ/checkout-champ-authorize-mode';
import { PaymentAdapter } from '../payment/payment-adapter';
import { SettlementMode } from '../payment/settlement-mode';
import { ConfigService } from '../support/config';

const IMPLEMENTED_PLACEMENTS = ['intake', 'post_checkout', 'receipt'];
const KNOWN_IDENTITY_CHECKS: readonly string[] = Object.values(IdentityCheck);

/**
 * `config:validate` — checks the
 * merged configuration for mistakes the type system cannot catch on its own.
 *
 * **Scoped, and deliberately so.** Every `config/*.ts` file is a TypeScript module with a typed
 * interface — `npm run typecheck` already refuses a `verification.ts` whose `enabled` is a string,
 * or a `payment.ts` missing a required field — so a missing key or a wrongly-typed value is caught
 * by the compiler instead of by this command.
 *
 * **What is deliberately not checked here:** payment-processor required-key checks on
 * `channel.generated.ts`; order-bump/upsell provider-mapping checks; consent-link reachability (the
 * route table isn't introspectable outside a booted HTTP server, and a check that can only ever
 * pass would be worse than no check); structured-data/SEO-URL `problems()` sweeps and a `--live`
 * EMR product-resolution pass (no equivalent exists yet on `StructuredData`/`MetaResolver`/
 * `RobotsPolicy`). A `--live` pass, if added, would resolve every `rx`/`otc`
 * product's `emr_product_id` against the live EMR; `lab`, `free-addon` and `priced-addon` products
 * are exempt, since they are not sold as standalone EMR products.
 *
 * **What is checked — the cross-file references and env-derived values a type checker cannot see:**
 * `app.debug.wireLog` left on (a live PCI/PHI violation while it runs, per `[15.8]`/`[22.21]`);
 * `abandonment.*`'s four numbers and its `marketingConsentKey` cross-reference into
 * `consent.consents`; `verification.*`'s placement/checks, when the step is enabled; `app.portal.url`
 * (warning only — the storefront still sells without a portal); and settlement (`validateSettlement()`):
 * whether the holds the catalog and its subscription plans ask for can be honoured by the
 * configured provider.
 *
 * Exit code 2 (not 1) on any error. Exit 0 when there are no
 * errors, whether or not there are warnings.
 */
@Command({ name: 'config:validate', description: 'Validate the merged configuration structurally' })
export class ConfigValidateCommand extends CommandRunner {
  constructor(
    private readonly config: ConfigService,
    private readonly catalog: CatalogProvider,
    @Inject(PAYMENT_ADAPTER) private readonly adapter: PaymentAdapter,
  ) {
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
    this.validateSettlement(errors, warnings);

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

  /**
   * The settlement the catalog asks for, and whether the configured provider can honour it.
   *
   * Errors, because each has the same consequence in production — an order either charges a card
   * the deployment meant to hold, or fails at checkout in front of a buyer:
   *  - a product's `settlement` key that is not a mode;
   *  - a plan whose settlement is not a mode (`theme:sync` only writes the two, so this is an
   *    override's typo, and its line would quietly settle as if it were sold one-off);
   *  - `payment.checkoutChamp.authorizeMode` that is not a mode, when CheckoutChamp is the provider;
   *  - anything asking for a hold — the default, one product, or a subscription plan that holds its
   *    first payment — on a provider without authorize-and-capture, which refuses every such order.
   *
   * Warnings, because the order still goes through, just not as somebody may have meant: a product
   * key that cannot reach the product's subscription variants, whose plan decides instead; and a
   * plan that holds the first payment of something that is not a prescription, which nothing
   * captures until a doctor approves one, so a cart with no prescription is charged at once.
   *
   * `payment.settlement` itself is not checked: `config/payment.ts` already reduces it to one of
   * the two modes.
   */
  private validateSettlement(errors: string[], warnings: string[]): void {
    let wantsAuthorize = SettlementMode.isAuthorize(this.config.payment.settlement);

    for (const product of this.catalog.products()) {
      let planned = false;
      for (const variant of product.variants ?? []) {
        for (const plan of VariantPlans.of(variant)) {
          planned = true;

          // A plan synced before plans said how they settle has no answer to check.
          const raw = plan[SettlementPolicy.PLAN_KEY];
          if (raw === undefined) continue;

          const mode = SettlementMode.parse(raw);
          if (mode === null) {
            errors.push(`payment: product ${product.slug} is sold on plan ${plan.id}, whose settlement is ${JSON.stringify(raw)}, which is neither "capture" nor "authorize".`);
            continue;
          }

          if (!SettlementMode.isAuthorize(mode)) continue;

          wantsAuthorize = true;
          if (product.kind !== 'rx') {
            warnings.push(`payment: plan ${plan.id} holds the first payment of product ${product.slug}, which is not a prescription — a hold is captured when a doctor approves a prescription, so a cart with none is charged at once instead.`);
          }
        }
      }

      if (product.settlement === undefined) continue;

      if (planned) {
        warnings.push(`payment: product ${product.slug} sets settlement, which does not apply to its variants sold on a subscription plan — those settle as their plan says.`);
      }

      const mode = SettlementMode.parse(product.settlement);
      if (mode === null) {
        errors.push(`payment: product ${product.slug} sets settlement to ${JSON.stringify(product.settlement)}, which is neither "capture" nor "authorize".`);
        continue;
      }

      wantsAuthorize = wantsAuthorize || SettlementMode.isAuthorize(mode);
    }

    const capabilities = this.adapter.capabilities();

    // Provider-scoped: a deployment on another adapter has no business being told about a key it does not read.
    const ccMode = this.config.payment.checkoutChamp.authorizeMode;
    if (capabilities.providerCategory === 'checkout_champ' && CheckoutChampAuthorizeMode.parse(ccMode) === null) {
      errors.push(`payment: payment.checkoutChamp.authorizeMode is ${JSON.stringify(ccMode)}, which is neither "qa" nor "preauth" — the storefront falls back to "qa".`);
    }

    if (wantsAuthorize && !capabilities.supportsAuthorizeCapture) {
      errors.push(`payment: settlement asks for an authorization but the ${capabilities.providerCategory} adapter does not support authorize-and-capture, so every such order is refused at checkout.`);
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

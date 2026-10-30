import { Inject, Injectable } from '@nestjs/common';
import { IDENTITY_GATEWAY, PRODUCT_CATALOG } from '../core/tokens';
import { Prefill } from '../checkout/prefill';
import { Cart } from '../domain/cart';
import { ProductCatalog } from '../domain/product-catalog';
import { AnswerSet } from '../forms/answer-set';
import { DateAnswer } from '../forms/date-answer';
import { Definition } from '../forms/definition';
import { TeleformMetadata } from '../forms/teleform-metadata';
import { TeleformSource } from '../forms/teleform-source';
import { FunnelRules } from '../funnel/funnel-rules';
import { JourneyState } from '../journey/journey-state';
import { ConfigService } from '../support/config';
import { OperatorLog } from '../support/operator-log';
import { IdentityGateway } from './identity-gateway';
import { IdentityCheckConfig, IdentityVerificationSequence } from './identity-verification-sequence';
import { IdentityVerdict } from './identity-verdict';

/**
 * The checkout field names `Prefill` produces, mapped to the names the identity provider
 * recognises. The provider takes `firstName`, `lastName`, `email`, `phone`, `dob`, `ssn`,
 * `ipAddress` and a nested `address`. The camel case is theirs, not ours.
 */
const IDENTITY_FIELD_FOR: Record<string, string> = {
  first_name: 'firstName',
  last_name: 'lastName',
  email: 'email',
  phone: 'phone',
};

/**
 * The same translation for the address block, which the provider takes nested rather than flat.
 *
 * `country` is deliberately absent (`[13.36]`) — this storefront collects no country anywhere, and
 * an assumed `US` would be an invented answer sent to a compliance check.
 */
const ADDRESS_FIELD_FOR: Record<string, string> = {
  address_line: 'streetAddress',
  city: 'city',
  territory: 'state',
  postal_code: 'postalCode',
};

/** The record path a date of birth is written to, per the verified `db_fields` mapping. */
const DOB_PATH = 'opportunity.dob';

/** The only field this step can ask for that no earlier step collects. */
const SELF_DECLARED = ['ssn'];

/**
 * Ported from storefront-lamp/core/Verification/VerificationStep.php. What the `/verify/` step
 * does: assemble an identity out of what the journey already knows, run the configured checks over
 * it, and write the outcome down (`[22.20]`).
 *
 * Assembling the identity is the part with a rule in it (`[13.5b]`): "checkout is assembled
 * dynamically from intake data, resolved through the same field mapping used to build the EMR
 * record, so there is one mapping, not two." The identity is read out of `Prefill`, which already
 * reads the questionnaire's own `db_fields` map backwards and already answers the precedence
 * question (stored answers first, working state second). What this class adds is the translation
 * from checkout field names to the provider's field names, and the one record path checkout has no
 * box for: a date of birth.
 *
 * **Data minimisation is enforced here, not in the template.** *Whether* to ask for a Social
 * Security fragment is `collectsSsn()`: only when the gateway is live *and* a configured check
 * actually names `ssn`. *How much* of one to send on is `lastFourOf()` — enforced here rather than
 * by an HTML `maxlength`, which is a hint to one browser and not a bound on what arrives.
 *
 * **Nothing identifying is logged.** The one line this class writes carries the verdict's own
 * `logContext()` and nothing else.
 */
@Injectable()
export class VerificationStep {
  private readonly rules: FunnelRules;
  private readonly sequence: IdentityVerificationSequence;
  /** The self-declared fields some configured check actually names. */
  private readonly wanted: string[];

  constructor(
    @Inject(IDENTITY_GATEWAY) private readonly gateway: IdentityGateway,
    private readonly forms: TeleformSource,
    @Inject(PRODUCT_CATALOG) catalog: ProductCatalog,
    private readonly log: OperatorLog,
    config: ConfigService,
  ) {
    const checks = config.verification.checks;
    this.rules = new FunnelRules(catalog);
    this.sequence = new IdentityVerificationSequence(gateway, checks);
    this.wanted = VerificationStep.wantedFields(checks);
  }

  /**
   * Whether the page should put the Social Security field on screen.
   *
   * Both halves are load-bearing. A deployment that has dropped the `ssn_verify` rung must not be
   * asked for an SSN it will never send, and a deployment with the integration switched off must
   * not be asked for one at all.
   */
  collectsSsn(): boolean {
    return this.gateway.isEnabled() && this.wanted.includes('ssn');
  }

  /**
   * Runs the configured checks and records what they said (`[22.20]`).
   *
   * The outcome is written to the journey whatever it is, including `inconclusive` — a step that
   * only records the answers it likes cannot be a compliance artefact. Whether the outcome stops
   * the visitor is not decided here — `StepPreconditions` is the single place that reads it.
   *
   * @param submitted this page's own POST body
   */
  async run(cart: Cart, state: JourneyState, submitted: Record<string, unknown>, ipAddress: string | null): Promise<IdentityVerdict> {
    const verdict = await this.sequence.run(await this.identity(cart, state, submitted, ipAddress));

    state.recordVerification(verdict.status, verdict.basis, verdict.check, verdict.reference);

    // Deliberately the verdict's own context and nothing else.
    this.log.info('verify.recorded', verdict.logContext());

    return verdict;
  }

  /** The identity to check, in the provider's own vocabulary. */
  private async identity(
    cart: Cart,
    state: JourneyState,
    submitted: Record<string, unknown>,
    ipAddress: string | null,
  ): Promise<Record<string, unknown>> {
    const [metadata, definition, answers] = await this.intake(cart, state);
    const prefilled = Prefill.from(metadata, definition, answers, state.buyer);

    const identity: Record<string, unknown> = {};

    for (const [field, name] of Object.entries(IDENTITY_FIELD_FOR)) {
      const value = String(prefilled[field] ?? '').trim();
      if (value !== '') identity[name] = value;
    }

    const address: Record<string, string> = {};
    for (const [field, name] of Object.entries(ADDRESS_FIELD_FOR)) {
      const value = String(prefilled[field] ?? '').trim();
      if (value !== '') address[name] = value;
    }
    if (Object.keys(address).length > 0) {
      identity.address = address;
    }

    const dob = VerificationStep.dob(metadata, definition, answers);
    if (dob !== null) identity.dob = dob;

    if (ipAddress !== null) identity.ipAddress = ipAddress;

    if (this.collectsSsn()) {
      const ssn = VerificationStep.lastFourOf(String(submitted.ssn ?? ''));
      if (ssn !== '') identity.ssn = ssn;
    }

    return identity;
  }

  /**
   * The last four digits of whatever was typed into the Social Security box, and never more than
   * four. Enforced here rather than relying on an HTML `maxlength` — a hint to one browser, absent
   * from a scripted post. Digits only, since the provider normalises before it caches.
   */
  private static lastFourOf(submitted: string): string {
    const digits = submitted.replace(/\D+/g, '');
    return digits.slice(-4);
  }

  /**
   * The questionnaire this cart collects and the answers held against it. Resolved exactly as
   * checkout resolves it, so prefill and identity see the same form: the first intake
   * questionnaire the cart names (`FunnelRules`).
   */
  private async intake(cart: Cart, state: JourneyState): Promise<[TeleformMetadata | null, Definition | null, AnswerSet | null]> {
    const teleformId = this.rules.intakeForms(cart)[0] ?? null;
    if (teleformId === null) return [null, null, null];

    let metadata: TeleformMetadata | null;
    try {
      metadata = await this.forms.metadataFor(teleformId);
    } catch (e) {
      this.log.warning('verify.intake_unavailable', { teleform: teleformId, exception: e instanceof Error ? e.constructor.name : 'unknown' });
      return [null, null, null];
    }

    if (metadata === null) return [null, null, null];

    let definition: Definition | null = null;
    try {
      definition = Definition.fromArray(await this.forms.definitionFor(teleformId));
    } catch (e) {
      this.log.warning('verify.intake_unavailable', { teleform: teleformId, exception: e instanceof Error ? e.constructor.name : 'unknown' });
    }

    return [metadata, definition, AnswerSet.fromArray(state.answersFor(teleformId))];
  }

  /**
   * The buyer's date of birth as `YYYY-MM-DD`, or null when the journey has none in a shape the
   * provider will accept. Read from the questionnaire's own `db_fields` map — the entry whose
   * record path is `opportunity.dob` — rather than from an answer called `date_of_birth`, so a form
   * author who renames the question keeps this working.
   */
  private static dob(metadata: TeleformMetadata | null, definition: Definition | null, answers: AnswerSet | null): string | null {
    if (metadata === null || definition === null || answers === null) return null;

    let raw = '';
    // `metadata.dbFields` is keyed by fieldId on a real teleform, not by the answer name
    // `answers.value()` needs — see `Definition.resolveDbFields()`'s doc comment.
    for (const [answerName, recordPath] of Object.entries(definition.resolveDbFields(metadata.dbFields))) {
      if (recordPath !== DOB_PATH) continue;

      const value = answers.value(answerName);
      raw = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value).trim() : '';
      break;
    }

    if (raw === '') return null;

    // Same two-format, round-trip-validated parse `DateAnswer.iso()` already does (ISO passthrough,
    // then MM/DD/YYYY) — a mis-parsed date here would be a *wrong* date of birth sent to an
    // identity check, so an unparseable value is dropped rather than guessed at.
    return DateAnswer.iso(raw);
  }

  /** Which of the fields this page could ask for are actually named by a configured check, in `required` or `narrowing`. */
  private static wantedFields(checks: IdentityCheckConfig[]): string[] {
    const named: string[] = [];

    for (const check of checks) {
      for (const field of [...check.required, ...check.narrowing]) {
        if (SELF_DECLARED.includes(field) && !named.includes(field)) {
          named.push(field);
        }
      }
    }

    return named;
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { CheckoutEvent, Response as AsterMDResponse } from '@astermd-hq/sdk';
import { EmrClientFactory } from '../emr/client-factory';
import { JourneyStoreFactory } from '../journey/journey-store-factory';
import { EventRepository } from '../repository/event-repository';
import { OrderRepository } from '../repository/order-repository';
import { CardScrubber } from '../support/card-scrubber';
import { ConfigService } from '../support/config';
import { OperatorLog } from '../support/operator-log';
import { CheckoutEventReporter, SyncedPayment } from './checkout-event-reporter';
import { PaymentDescriptor } from '../payment/payment-descriptor';
import { Totals } from './totals';
import { VerificationGateway } from '../emr/verification-gateway';
import { ExtendedTreatmentSyncOptions, VerificationBlock } from '../emr/treatment-sync-options';
import { VerificationRecord } from '../journey/journey-state';

/** What an import with no browser behind it is attributed to — a sweep has no buyer device. */
const STOREFRONT_AGENT = 'AsterMD-Storefront';

/** The identity checks `config/verification.ts` runs, as the treatments sync names their method. */
const IDENTITY_METHOD_FOR: Record<string, NonNullable<VerificationBlock['id']>['method']> = {
  crosscheck: 'cross_check',
  dob_verify: 'dob',
  ssn_verify: 'ssn',
};

/** What the local trail files a checkout under when there is no analytics session to file it under. */
const NO_SESSION = '';

/**
 * Ported from storefront-lamp/core/Checkout/EmrCheckoutEventReporter.php. {@link CheckoutEventReporter}
 * over the EMR's checkout-event funnel (`client.checkoutEvents()`), the real treatment sync
 * (`client.treatments().sync()`), and the local `events` table.
 *
 * **This is a swallow-and-log boundary**, the same pattern `EmrLeadGateway`/`RecordingIntakeGateway`
 * use: tracking, analytics and reporting must never break the storefront — an order that was
 * charged is not un-charged because the EMR did not hear about it, so every method here catches
 * everything, logs a warning, and never throws.
 *
 * **Two destinations, not redundant.** The EMR keeps *one* checkout-event record per session and
 * overwrites `event` on every `update()`, so a decline followed by a success leaves only the
 * success visible there — fine for the EMR's own funnel reporting, useless as an audit trail. The
 * local `events` table (`EventRepository`, append-only) is that trail, and it is written whatever
 * `session.analytics` says and whether or not there is a session uuid — an analytics-off deployment
 * still gets its local `checkout.*` rows, filed under `NO_SESSION` when there is no uuid, the
 * absence recorded literally rather than an invented identifier.
 *
 * **Dollars are converted here and nowhere else** — the EMR documents floats, `Totals` carries
 * integer cents, and `Totals.dollars()` is the one conversion point.
 *
 * **`payment` and `verification` ride the treatments sync, as in PHP** (`payment` is
 * `PaymentDescriptor.toArray()`, omitted when there is none; `verification` is
 * `{ email: true, address: false }` only for a deliverable buyer email). The installed
 * `@astermd-hq/sdk` 0.0.2 has no such fields and drops them — a release matching PHP astermd/sdk
 * 0.0.3 is required; see {@link ExtendedTreatmentSyncOptions}. Only `orderPlaced` has a descriptor
 * to thread; the receipt batch and the reconciliation sweep sync without one, exactly as lamp does.
 */
@Injectable()
export class EmrCheckoutEventReporter implements CheckoutEventReporter {
  constructor(
    private readonly clients: EmrClientFactory,
    private readonly events: EventRepository,
    private readonly orders: OrderRepository,
    private readonly log: OperatorLog,
    private readonly journeyStoreFactory: JourneyStoreFactory,
    private readonly config: ConfigService,
    @Inject(REQUEST) private readonly request: Request,
    private readonly verification: VerificationGateway | null = null,
  ) {}

  async checkoutVisited(sessionUuid: string | null, totals: Totals): Promise<void> {
    await this.record(sessionUuid, 'checkout.visited', { subtotal_cents: totals.subtotalCents, total_cents: totals.totalCents });

    if (sessionUuid === null) return;

    await this.send(sessionUuid, 'checkout_visited', async (client) => {
      await client.checkoutEvents().create(sessionUuid, { ...EmrCheckoutEventReporter.money(totals), currency: this.currency() });
    });
  }

  async orderPlaced(sessionUuid: string | null, totals: Totals, paymentMethod: string, references: string[], payment: PaymentDescriptor): Promise<void> {
    await this.record(sessionUuid, 'checkout.order_placed', {
      references: references.join(','),
      total_cents: totals.totalCents,
      payment_method: paymentMethod,
    });

    if (sessionUuid === null) return;

    await this.send(sessionUuid, 'order_placed', async (client) => {
      await client.checkoutEvents().update({
        session: sessionUuid,
        event: CheckoutEvent.OrderPlaced,
        data: {
          ...EmrCheckoutEventReporter.money(totals),
          payment_method: paymentMethod,
          currency: this.currency(),
          provider_order_id: references,
          ...EmrCheckoutEventReporter.paymentBlock(payment),
        },
      });
    });

    // Synced here too, not only from `Completion`'s later receipt-time batch — PHP's own
    // `orderPlaced()` does the same, measured live against the real EMR as safe to repeat (it
    // dedupes by session, accumulating references onto one treatment record rather than creating
    // a second). Reporting the *prescription* order the moment it is charged, rather than waiting
    // for the receipt, is what closes a real gap: a buyer who closes the tab mid-upsell never
    // reaches the receipt, and without this call their already-charged treatment would never reach
    // a clinician's queue at all.
    await this.treatmentsSynced(sessionUuid, references, payment);
  }

  async orderDeclined(
    sessionUuid: string | null,
    totals: Totals,
    paymentMethod: string,
    reference: string | null,
    reason: string,
    payment: PaymentDescriptor | null,
  ): Promise<void> {
    // Scrubbed on the way in — `events.payload` is durable and `reason` is not a key OperatorLog's
    // own redaction names, so a provider that put a card number inside its own sentence would
    // otherwise write one to a table.
    await this.record(sessionUuid, 'checkout.order_declined', {
      reference,
      total_cents: totals.totalCents,
      payment_method: paymentMethod,
      reason: CardScrubber.scrub(reason),
    });

    if (sessionUuid === null) return;

    await this.send(sessionUuid, 'order_declined', async (client) => {
      await client.checkoutEvents().update({
        session: sessionUuid,
        event: CheckoutEvent.OrderDeclined,
        data: {
          ...EmrCheckoutEventReporter.money(totals),
          payment_method: paymentMethod,
          currency: this.currency(),
          provider_order_id: reference === null ? [] : [reference],
          ...EmrCheckoutEventReporter.paymentBlock(payment),
        },
      });
    });
  }

  async orderBump(sessionUuid: string | null, slug: string, accepted: boolean): Promise<void> {
    await this.record(sessionUuid, accepted ? 'checkout.bump_accepted' : 'checkout.bump_withdrawn', { slug });
  }

  async upsellOffered(sessionUuid: string | null, slug: string, name: string): Promise<void> {
    await this.upsellEvent(sessionUuid, 'offered', CheckoutEvent.UpsellOffered, slug, name);
  }

  async upsellAccepted(sessionUuid: string | null, slug: string, name: string): Promise<void> {
    await this.upsellEvent(sessionUuid, 'accepted', CheckoutEvent.UpsellAccepted, slug, name);
  }

  async upsellDeclined(sessionUuid: string | null, slug: string, name: string): Promise<void> {
    await this.upsellEvent(sessionUuid, 'declined', CheckoutEvent.UpsellDeclined, slug, name);
  }

  async journeyCompleted(
    sessionUuid: string | null,
    placed: boolean,
    subtotalCents: number,
    paidTotalCents: number,
    paymentMethod: string | null,
    references: string[],
    opportunityId: string | null,
  ): Promise<void> {
    const event = placed ? CheckoutEvent.OrderPlaced : CheckoutEvent.OrderDeclined;

    await this.record(sessionUuid, 'checkout.completed', {
      event,
      references: references.join(','),
      order_value_cents: subtotalCents,
      paid_total_cents: paidTotalCents,
      payment_method: paymentMethod,
      opportunity_id: opportunityId,
    });

    if (sessionUuid === null) return;

    const data: Record<string, unknown> = {
      order_value: Totals.dollars(subtotalCents),
      order_total: Totals.dollars(paidTotalCents),
      currency: this.currency(),
      provider_order_id: references,
    };

    // Omitted rather than sent empty when there is nothing to send — the EMR accepts a fixed set
    // of payment methods and an absent key is a fact it can read; `''` is not.
    if (paymentMethod !== null) data.payment_method = paymentMethod;
    if (opportunityId !== null) data.opportunity_id = opportunityId;

    await this.send(sessionUuid, event, async (client) => {
      await client.checkoutEvents().update({ session: sessionUuid, event, data });
    });
  }

  /**
   * Tells the EMR about orders the aggregator has already charged, and stamps what it returns onto
   * the local rows. An order the provider charged but the EMR never learned of is the set of rows
   * whose `treatment_reference` stays null — exactly what `ForwardReconciliation`'s sweep looks
   * for, so a failure here is recoverable later rather than silently lost.
   */
  async treatmentsSynced(sessionUuid: string | null, references: string[], payment: SyncedPayment | null = null): Promise<void> {
    if (sessionUuid === null || !this.reportToEmr() || references.length === 0) return;

    let response: AsterMDResponse<Record<string, unknown>[]>;
    try {
      const verification = await this.verificationBlock();
      const options: ExtendedTreatmentSyncOptions = {
        session: sessionUuid,
        orderIds: references,
        utmSource: this.utmSource() ?? undefined,
        userAgent: await this.userAgentFor(references),
        ...(payment === null ? {} : { payment: payment instanceof PaymentDescriptor ? payment.toArray() : payment }),
        ...(verification === null ? {} : { verification }),
      };
      response = await this.clients.create().treatments().sync<Record<string, unknown>[]>(options);
    } catch (e) {
      this.log.warning('checkout.treatment_sync_failed', {
        session: sessionUuid,
        orders: references.length,
        exception: e instanceof Error ? e.constructor.name : 'unknown',
      });
      return;
    }

    await this.record(sessionUuid, 'checkout.treatments_synced', { references: references.join(','), orders: references.length });

    const treatment = EmrCheckoutEventReporter.treatmentIdentifierIn(response);
    for (const reference of references) {
      await this.stampTreatmentReference(reference, treatment ?? reference);
    }
  }

  /**
   * The `User-Agent` this import is attributed to, closest-to-the-buyer first: the ambient
   * request (right whenever there is one), then whichever order row already stored one (read by
   * a later reconciliation sweep with no request of its own), then the storefront's own token —
   * required and non-empty, since the SDK rejects an empty one.
   */
  private async userAgentFor(references: string[]): Promise<string> {
    const ambient = (this.request.get('User-Agent') ?? '').trim();
    if (ambient !== '') return ambient;

    for (const reference of references) {
      const row = await this.orders.findByReference(reference);
      const stored = (row?.userAgent ?? '').trim();
      if (stored !== '') return stored;
    }

    return STOREFRONT_AGENT;
  }

  /**
   * What this storefront has actually verified about the buyer — only what was checked, never a row
   * of falses. `address` is false because no address is ever verified here (`normaliseAddress()` has
   * no caller). Only a literal `true` counts: `null` means the check could not run, which passes
   * checkout validation without verifying anything. The gateway memoises, so this read costs no
   * extra round trip.
   */
  private async verificationBlock(): Promise<VerificationBlock | null> {
    const state = this.journeyStoreFactory.get().currentState();
    const email = (state?.buyer?.email ?? '').trim();

    const emailVerified =
      email !== '' && this.verification !== null && this.verification.isEnabled() && (await this.verification.emailIsDeliverable(email)) === true;
    const id = EmrCheckoutEventReporter.identityBlock(state?.verification ?? null);

    if (!emailVerified && id === null) return null;

    return { email: emailVerified, address: false, ...(id === null ? {} : { id }) };
  }

  /**
   * The identity check's outcome, from the verdict `VerificationStep` recorded on the journey.
   * Only a decisive verdict is reported — `inconclusive` means the check could not run, which
   * verified nothing — and only when the check maps to a method the EMR knows. `value` is the
   * provider's own `basis` when it gave one (a coded descriptor, safe to log), else the method
   * itself: never an SSN or date of birth, which this class never holds.
   */
  private static identityBlock(record: VerificationRecord | null): VerificationBlock['id'] | null {
    if (record === null || record.status === 'inconclusive') return null;

    const method = record.check === null ? undefined : IDENTITY_METHOD_FOR[record.check];
    if (method === undefined) return null;

    return { verified: record.status === 'passed', method, value: record.basis ?? method };
  }

  private utmSource(): string | null {
    const attribution = this.journeyStoreFactory.get().currentState()?.attribution ?? null;
    const source = attribution?.get('utm_source');
    return typeof source === 'string' && source.trim() !== '' ? source : null;
  }

  private currency(): string {
    return String(this.config.get('payment.currency', 'USD'));
  }

  private reportToEmr(): boolean {
    return this.config.app.session.analytics;
  }

  private async upsellEvent(sessionUuid: string | null, outcome: string, event: CheckoutEvent, slug: string, name: string): Promise<void> {
    await this.record(sessionUuid, `checkout.upsell_${outcome}`, { slug });

    if (sessionUuid === null) return;

    await this.send(sessionUuid, event, async (client) => {
      await client.checkoutEvents().update({ session: sessionUuid, event, data: { product_id: slug, product_name: name } });
    });
  }

  /** One line on the local trail, written whether or not this journey has an analytics session. */
  private async record(sessionUuid: string | null, name: string, payload: Record<string, unknown>): Promise<void> {
    await this.events.append(sessionUuid ?? NO_SESSION, name, payload);
  }

  /** One EMR call, with the boundary's whole swallow-and-log contract applied to it. */
  private async send(sessionUuid: string, event: string, call: (client: ReturnType<EmrClientFactory['create']>) => Promise<void>): Promise<void> {
    if (!this.reportToEmr()) return;

    try {
      await call(this.clients.create());
    } catch (e) {
      this.log.warning('checkout.event_report_failed', {
        session: sessionUuid,
        event,
        exception: e instanceof Error ? e.constructor.name : 'unknown',
      });
    }
  }

  /** Records the EMR's own treatment identifier against one local order, falling back to the provider's own reference when it cannot be read. */
  private async stampTreatmentReference(orderReference: string, treatmentReference: string): Promise<void> {
    try {
      const row = await this.orders.findByReference(orderReference);
      if (row !== null) {
        await this.orders.markTreatmentSynced(row.id, treatmentReference);
      }
    } catch (e) {
      this.log.warning('checkout.treatment_stamp_failed', {
        reference: orderReference,
        exception: e instanceof Error ? e.constructor.name : 'unknown',
      });
    }
  }

  /**
   * The EMR treatment id out of a sync response, or null when the body does not carry a usable
   * one. `data()` is a list, not an object — the sync envelope's `data` holds one element per
   * treatment record, id at `data()[0]._id` — confirmed against PHP's own measured behaviour
   * against the same real API. Anything that is not a non-empty string is refused rather than
   * cast, since a value no later lookup could use would still report success.
   */
  private static treatmentIdentifierIn(response: AsterMDResponse<Record<string, unknown>[]>): string | null {
    const data = response.data();
    const first = Array.isArray(data) ? data[0] : undefined;
    if (!first || typeof first !== 'object') return null;

    const id = first._id;
    return typeof id === 'string' && id !== '' ? id : null;
  }

  /** The `payment` key, or no key at all — an empty object would assert a payment method nothing observed. */
  private static paymentBlock(payment: PaymentDescriptor | null): Record<string, unknown> {
    return payment === null ? {} : { payment: payment.toArray() };
  }

  /** The two money fields, in the decimal dollars the EMR documents. */
  private static money(totals: Totals): { order_value: number; order_total: number } {
    return { order_value: Totals.dollars(totals.subtotalCents), order_total: Totals.dollars(totals.totalCents) };
  }
}

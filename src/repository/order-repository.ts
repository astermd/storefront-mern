import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DATABASE_CONNECTION } from '../core/tokens';

export interface OrderInsertData {
  session_uuid?: string | null;
  provider_reference: string;
  anchor_slug: string;
  amount_cents: number;
  currency: string;
  status: string;
  buyer_email?: string | null;
  buyer_name?: string | null;
  buyer_territory?: string | null;
  discount_cents?: number;
  promotion_code?: string | null;
  payment_method?: string | null;
  card_last_four?: string | null;
  idempotency_key?: string | null;
  provider_category?: string | null;
  placed_at?: string | null;
  is_upsell?: boolean;
  settlement?: string;
  user_agent?: string | null;
}

export interface OrderLineInsertData {
  slug: string;
  name: string;
  kind?: string;
  provider_offer?: string | null;
  provider_item?: string | null;
  unit_price_cents: number;
  quantity: number;
  sent_to_provider?: boolean;
}

export interface OrderConsentInsertData {
  key: string;
  granted: boolean;
  copy_version: string;
  copy_shown: string;
  at: string;
}

export interface UnsyncedOrderRow {
  id: number;
  providerReference: string;
  sessionUuid: string | null;
  status: string;
  placedAt: string;
}

/**
 * Ported from storefront-lamp/core/Repository/OrderRepository.php. The `orders`, `order_lines` and
 * `order_consents` tables: the storefront's own record of what was bought, for how much, and what
 * the buyer agreed to.
 *
 * **No card ever reaches this class.** `card_last_four` is the only card-derived value it accepts —
 * four digits are what a receipt and a support call need (`[15.8]`).
 *
 * `insert()`/`findByReference()` are Phase 7; the sync/reconciliation queries below
 * (`findUnsyncedPlacedBefore`, `countUnsynced*`, `markTreatmentSynced`) are Phase 10, added for
 * `ForwardReconciliation`/`ops:status`.
 */
@Injectable()
export class OrderRepository {
  constructor(@Inject(DATABASE_CONNECTION) private readonly prisma: PrismaClient) {}

  /**
   * Writes one order together with its lines and its consents, in a single transaction — a
   * half-written order is worse than no local record at all, since the money has already moved by
   * the time this is called.
   */
  async insert(order: OrderInsertData, lines: OrderLineInsertData[], consents: OrderConsentInsertData[]): Promise<number> {
    const now = new Date().toISOString();

    const created = await this.prisma.order.create({
      data: {
        sessionUuid: order.session_uuid ?? null,
        providerReference: order.provider_reference,
        anchorSlug: order.anchor_slug,
        amountCents: order.amount_cents,
        currency: order.currency,
        status: order.status,
        buyerEmail: order.buyer_email ?? null,
        buyerName: order.buyer_name ?? null,
        buyerTerritory: order.buyer_territory ?? null,
        discountCents: order.discount_cents ?? 0,
        promotionCode: order.promotion_code ?? null,
        paymentMethod: order.payment_method ?? null,
        cardLastFour: order.card_last_four ?? null,
        idempotencyKey: order.idempotency_key ?? null,
        providerCategory: order.provider_category ?? null,
        placedAt: order.placed_at ?? now,
        isUpsell: order.is_upsell === true ? 1 : 0,
        settlement: order.settlement ?? 'capture',
        // Null rather than empty: "sent blank" and "not sent" stay distinguishable.
        userAgent: order.user_agent?.trim() ? order.user_agent : null,
        createdAt: now,
        updatedAt: now,
        lines: {
          create: lines.map((line) => ({
            slug: line.slug,
            name: line.name,
            kind: line.kind ?? 'otc',
            providerOffer: line.provider_offer ?? null,
            providerItem: line.provider_item ?? null,
            unitPriceCents: line.unit_price_cents,
            quantity: line.quantity,
            sentToProvider: (line.sent_to_provider ?? true) ? 1 : 0,
          })),
        },
        consents: {
          create: consents.map((consent) => ({
            consentKey: consent.key,
            granted: consent.granted ? 1 : 0,
            copyVersion: consent.copy_version,
            copyShown: consent.copy_shown,
            recordedAt: consent.at,
          })),
        },
      },
    });

    return created.id;
  }

  /**
   * The whole order — header, lines and consents — as the provider's reference names it.
   *
   * **Most recent wins.** `provider_reference` is not unique — a decline and the retry that
   * succeeds can carry the same reference — so the newest row is the one that stands.
   */
  async findByReference(reference: string) {
    return this.prisma.order.findFirst({
      where: { providerReference: reference },
      orderBy: { id: 'desc' },
      include: { lines: true, consents: true },
    });
  }

  /**
   * The orders the EMR was never told about, oldest first, bounded — `ForwardReconciliation`'s one
   * read. `treatmentReference IS NULL` is the durable signal `markTreatmentSynced()` writes;
   * `placedAt` falls back to `createdAt` (the PHP original's `COALESCE`) for a row written before a
   * placement time was ever recorded — in practice every row this port writes sets `placedAt` at
   * insert, so the fallback exists for parity rather than a live case. `status` is returned, not
   * filtered on — the caller decides what's sendable.
   */
  async findUnsyncedPlacedBefore(placedBefore: string, limit: number): Promise<UnsyncedOrderRow[]> {
    const take = Math.max(0, limit);
    if (take === 0) return [];

    const rows = await this.prisma.order.findMany({
      where: {
        treatmentReference: null,
        OR: [{ placedAt: { lt: placedBefore } }, { placedAt: null, createdAt: { lt: placedBefore } }],
      },
      orderBy: [{ placedAt: 'asc' }, { id: 'asc' }],
      take,
      select: { id: true, providerReference: true, sessionUuid: true, status: true, placedAt: true, createdAt: true },
    });

    return rows.map((row) => ({
      id: row.id,
      providerReference: row.providerReference,
      sessionUuid: row.sessionUuid,
      status: row.status,
      placedAt: row.placedAt ?? row.createdAt,
    }));
  }

  /** Records the EMR treatment reference a successful post-placement sync returned. */
  async markTreatmentSynced(id: number, reference: string): Promise<void> {
    await this.prisma.order.update({ where: { id }, data: { treatmentReference: reference, updatedAt: new Date().toISOString() } });
  }

  /** How many orders the EMR has never been told about, at all. Ignores the grace window deliberately. */
  async countUnsynced(): Promise<number> {
    return this.prisma.order.count({ where: { treatmentReference: null } });
  }

  /**
   * The reconciliation backlog (or the repeat-failure figure, with an older cutoff). Excludes rows
   * with no `sessionUuid` — those can never be synced by any retry, and are reported separately by
   * `countUnsyncedWithoutSession()`.
   */
  async countUnsyncedPlacedBefore(placedBefore: string): Promise<number> {
    return this.prisma.order.count({
      where: {
        treatmentReference: null,
        sessionUuid: { not: null },
        OR: [{ placedAt: { lt: placedBefore } }, { placedAt: null, createdAt: { lt: placedBefore } }],
      },
    });
  }

  /** Never told, and with no analytics session to tell anyone under — disjoint from the backlog above. */
  async countUnsyncedWithoutSession(): Promise<number> {
    return this.prisma.order.count({ where: { treatmentReference: null, sessionUuid: null } });
  }
}

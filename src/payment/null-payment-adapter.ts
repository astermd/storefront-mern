import { Injectable } from '@nestjs/common';
import {
  SCOPE_LINE_ITEM,
  STRATEGY_TOKENIZATION,
  SURFACE_THEME_FIELDS,
  AdapterCapabilities,
} from './adapter-capabilities';
import { CaptureOutcome } from './capture-outcome';
import { CaptureRequest } from './capture-request';
import { OrderEnvelope } from './order-envelope';
import { OrderSearch } from './order-search';
import { OrderSearchResult } from './order-search-result';
import { PaymentAdapter } from './payment-adapter';
import { PaymentCredential } from './payment-credential';
import { PlacementOutcome } from './placement-outcome';
import { PromotionQuote } from './promotion-quote';

const DECLINE_MESSAGE = 'Online payment is temporarily unavailable. Please try again shortly.';

/**
 * Ported from storefront-lamp/core/Payment/NullPaymentAdapter.php — the adapter bound whenever
 * `AdapterRegistry` resolves no configured provider category. The Phase 7 reference adapter: no
 * live provider integration exists in this port at all, so this is the only adapter that ever
 * actually runs a real checkout submit through.
 */
@Injectable()
export class NullPaymentAdapter implements PaymentAdapter {
  capabilities(): AdapterCapabilities {
    return new AdapterCapabilities(
      'none',
      false,
      SCOPE_LINE_ITEM,
      STRATEGY_TOKENIZATION,
      SURFACE_THEME_FIELDS,
      [],
      [],
      'No provider configured; no card data is transmitted or held.',
      false,
      false,
      false,
      false,
      [],
      {},
      false,
    );
  }

  async place(_order: OrderEnvelope, _credential: PaymentCredential): Promise<PlacementOutcome> {
    // `no_provider_configured` is the one rawStatus `CheckoutAttempt.UNRESOLVED_STATUSES`
    // deliberately excludes, so this decline's idempotency key IS released.
    return PlacementOutcome.declined(null, DECLINE_MESSAGE, 'no_provider_configured');
  }

  async resume(reference: string): Promise<PlacementOutcome> {
    return PlacementOutcome.declined(reference, DECLINE_MESSAGE, 'no_provider_configured');
  }

  async quotePromotion(_order: OrderEnvelope, code: string): Promise<PromotionQuote> {
    return PromotionQuote.rejected(code, 'unsupported');
  }

  async searchOrders(_search: OrderSearch): Promise<OrderSearchResult> {
    return OrderSearchResult.unsupported();
  }

  /** Not `failed` — a failed capture invites a retry that would never succeed. */
  async capture(_request: CaptureRequest): Promise<CaptureOutcome> {
    return CaptureOutcome.unsupported();
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    return { ok: false, detail: 'No payment provider is configured for this channel.' };
  }
}

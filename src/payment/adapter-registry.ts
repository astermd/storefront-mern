import { Injectable } from '@nestjs/common';
import { OperatorLog } from '../support/operator-log';
import { NullPaymentAdapter } from './null-payment-adapter';
import { PaymentAdapter } from './payment-adapter';

/**
 * Ported from storefront-lamp/core/Payment/AdapterRegistry.php. Resolve-by-category-with-
 * catch-to-Null — the one port (`PAYMENT_ADAPTER`) that degrades via a registry rather than a
 * config-gated ternary like the other EMR-family ports. This port ships **zero adapters
 * registered**, so every resolve falls through to `NullPaymentAdapter` — no live payment provider
 * integration exists in this port at all (see MERN.md).
 */
@Injectable()
export class AdapterRegistry {
  /** Factories, not instances — building one reads credentials/constructs an HTTP client, which must only happen for the configured category. */
  private readonly factories = new Map<string, () => PaymentAdapter>();
  private readonly resolved = new Map<string, PaymentAdapter>();

  constructor(private readonly log: OperatorLog) {}

  register(category: string, factory: () => PaymentAdapter): void {
    this.factories.set(category, factory);
  }

  for(category: string | null): PaymentAdapter {
    if (!category || !this.factories.has(category)) {
      this.log.warning('payment.adapter_unavailable', { category });
      return new NullPaymentAdapter();
    }

    const memoized = this.resolved.get(category);
    if (memoized) return memoized;

    try {
      const adapter = this.factories.get(category)!();
      this.resolved.set(category, adapter);
      return adapter;
    } catch (e) {
      this.log.error('payment.adapter_build_failed', { category, exception: e instanceof Error ? e.constructor.name : 'unknown' });
      return new NullPaymentAdapter();
    }
  }
}

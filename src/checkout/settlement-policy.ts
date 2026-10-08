import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PRODUCT_CATALOG } from '../core/tokens';
import { ProductCatalog } from '../domain/product-catalog';
import { OperatorLog } from '../support/operator-log';
import { ConfigService } from '../support/config';
import { SettlementMode, SettlementModeValue } from '../payment/settlement-mode';

/**
 * Ported from storefront-lamp/core/Checkout/SettlementPolicy.php. Whether an order takes the money
 * or reserves it — decided once, here.
 *
 * Two layers: the deployment default (`config/payment.ts`) answers "how does this storefront
 * settle"; the per-product `settlement` override key answers "does this particular thing get
 * charged before somebody has approved it" — a clinical or fulfilment fact that varies inside one
 * deployment.
 *
 * **A cart resolves to one mode, and authorize wins** (`[13.19]`: the whole cart is one order). An
 * unrecognised spelling falls back to the deployment default and is logged, rather than guessed at
 * in either direction.
 */
@Injectable()
export class SettlementPolicy {
  private readonly default: SettlementModeValue;

  constructor(
    @Inject(PRODUCT_CATALOG) private readonly catalog: ProductCatalog,
    config: ConfigService,
    private readonly log: OperatorLog,
  ) {
    this.default = SettlementPolicy.modeFromConfig(config.payment.settlement);
  }

  static modeFromConfig(configured: unknown): SettlementModeValue {
    return SettlementMode.parse(configured) ?? SettlementMode.Capture;
  }

  /** The mode for an order covering these product slugs. Total over the empty case — an upsell envelope carries exactly one line. */
  forSlugs(...slugs: string[]): SettlementModeValue {
    return SettlementMode.strictest(this.default, ...slugs.map((slug) => this.forSlug(slug)));
  }

  /** The mode one product asks for, or the deployment default when it asks for nothing (or names no product at all — free attachments/bundle children reach here too). */
  forSlug(slug: string): SettlementModeValue {
    const product = this.catalog.product(slug);
    if (product === null || product.settlement === undefined) {
      return this.default;
    }

    const parsed = SettlementMode.parse(product.settlement);
    if (parsed === null) {
      this.log.error('checkout.settlement_unrecognised', { slug, default: this.default });
      return this.default;
    }

    return parsed;
  }
}

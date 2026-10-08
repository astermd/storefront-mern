/**
 * Ported from storefront-lamp/core/Payment/AdapterCapabilities.php. What one payment adapter can
 * and cannot do — read by the checkout service to decide whether a cart's settlement requirements
 * are even satisfiable before ever calling the adapter.
 */
export const SCOPE_LINE_ITEM = 'line-item';
export const SCOPE_ORDER_LEVEL = 'order-level';
export const STRATEGY_TOKENIZATION = 'tokenization';
export const STRATEGY_RAW_CARRY_FORWARD = 'raw-card-carry-forward';
export const STRATEGY_ORDER_REFERENCE = 'reference-order';
export const SURFACE_THEME_FIELDS = 'theme-fields';
export const SURFACE_PROVIDER_HOSTED = 'provider-hosted';

export class AdapterCapabilities {
  constructor(
    public readonly providerCategory: string,
    public readonly supportsPromotions: boolean,
    public readonly discountScope: string,
    public readonly credentialStrategy: string,
    public readonly collectionSurface: string,
    public readonly requiredConfigKeys: string[],
    public readonly routingHintKeys: string[],
    public readonly pciPosture: string,
    public readonly supportsRefund: boolean = false,
    public readonly supportsRecurring: boolean = false,
    public readonly supportsOrderSearch: boolean = false,
    /** Defaults false — an adapter written before this capability existed refuses rather than silently captures. */
    public readonly supportsAuthorizeCapture: boolean = false,
    public readonly requiredDeploymentKeys: string[] = [],
  ) {}

  rendersOwnCardFields(): boolean {
    return this.collectionSurface === SURFACE_THEME_FIELDS;
  }
}

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
    /**
     * What a provider-hosted surface needs on the page to mount its fields (`[15.4c]`) — a
     * publishable key, never a secret. Rendered into the checkout page verbatim, so an adapter puts
     * nothing in it that a visitor may not read.
     */
    public readonly clientConfig: Record<string, string> = {},
    /**
     * Whether a pending outcome can be finished on the page (`[14.22]`): the provider's own script
     * runs the challenge, and `PaymentAdapter.resume()` reads back what happened. False means the
     * challenge stops the checkout instead, which is what every adapter did before the round trip
     * existed — so it defaults to false.
     */
    public readonly supportsClientAction: boolean = false,
  ) {}

  rendersOwnCardFields(): boolean {
    return this.collectionSurface === SURFACE_THEME_FIELDS;
  }
}

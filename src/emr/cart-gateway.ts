import { CartMirrorResult } from './cart-mirror-result';

export interface CartMirrorItem {
  productId: string;
  /** Rides along only when the line has one — a variant-less line sends no key, never a blank one. */
  variantId?: string;
  name: string;
  qty: number;
}

/**
 * Ported from storefront-lamp/core/Emr/CartGateway.php. The storefront's view of the EMR's cart
 * resource: replace the remote cart for a session, and say which of the three outcomes happened.
 */
export interface CartGateway {
  create(session: string, items: CartMirrorItem[]): Promise<CartMirrorResult>;
  update(session: string, items: CartMirrorItem[]): Promise<CartMirrorResult>;
}

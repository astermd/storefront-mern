import { Injectable } from '@nestjs/common';
import { ApiError, NotFoundError } from '@astermd-hq/sdk';
import { OperatorLog } from '../support/operator-log';
import { CartGateway, CartMirrorItem } from './cart-gateway';
import { CartMirrorResult } from './cart-mirror-result';
import { EmrClientFactory } from './client-factory';

/**
 * Ported from storefront-lamp/core/Emr/EmrCartGateway.php. {@link CartGateway} over the SDK's
 * `carts()` resource.
 *
 * `NotFound` is separated from every other failure because it is the one the caller can repair:
 * the EMR has no cart for this session, so the next call should be a create rather than another
 * update.
 *
 * The exception *message* never reaches the log. The SDK builds it from the provider's own
 * `message` field, and the payload this class sends carries a product name per line, so a
 * provider that echoes the request or explains the rejection would put a prescription name in the
 * operator log next to the session id. It is replaced by the exception class and the status code
 * it carries instead — those two answer the questions an outage actually raises (is this auth,
 * rate limiting, validation, transport, or the provider being down) without carrying
 * provider-supplied free text.
 *
 * The event name is `cart.mirror_request_failed`, distinct from `cart.mirror_failed` (written by
 * `CartMirror` for the same incident) — `CartMirror` logs the outcome of mirroring a cart; this
 * logs one failed call to the provider, and a mirror can make two of them (an update that 404s,
 * then a create).
 */
@Injectable()
export class EmrCartGateway implements CartGateway {
  constructor(
    private readonly clients: EmrClientFactory,
    private readonly log: OperatorLog,
  ) {}

  async create(session: string, items: CartMirrorItem[]): Promise<CartMirrorResult> {
    try {
      await this.clients.create().carts().create({ session, items: EmrCartGateway.toWireItems(items) });
      return CartMirrorResult.Ok;
    } catch (e) {
      this.log.warning('cart.mirror_request_failed', {
        session,
        operation: 'create',
        items: items.length,
        exception: (e as Error).constructor.name,
        status: e instanceof ApiError ? e.statusCode() : null,
      });
      return CartMirrorResult.Failed;
    }
  }

  async update(session: string, items: CartMirrorItem[]): Promise<CartMirrorResult> {
    try {
      await this.clients.create().carts().update({ session, items: EmrCartGateway.toWireItems(items) });
      return CartMirrorResult.Ok;
    } catch (e) {
      if (e instanceof NotFoundError) {
        return CartMirrorResult.NotFound;
      }
      this.log.warning('cart.mirror_request_failed', {
        session,
        operation: 'update',
        items: items.length,
        exception: (e as Error).constructor.name,
        status: e instanceof ApiError ? e.statusCode() : null,
      });
      return CartMirrorResult.Failed;
    }
  }

  /** `CartMirrorItem`'s camelCase fields, translated to the wire shape `CartMirror.php` sends. */
  private static toWireItems(items: CartMirrorItem[]): Record<string, unknown>[] {
    return items.map((item) => ({
      product_id: item.productId,
      ...(item.variantId ? { variant_id: item.variantId } : {}),
      name: item.name,
      qty: item.qty,
    }));
  }
}

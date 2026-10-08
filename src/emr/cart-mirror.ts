import { Inject, Injectable } from '@nestjs/common';
import { Cart } from '../domain/cart';
import { JourneyState } from '../journey/journey-state';
import { EventRepository } from '../repository/event-repository';
import { OperatorLog } from '../support/operator-log';
import { CART_GATEWAY } from '../core/tokens';
import { CartGateway, CartMirrorItem } from './cart-gateway';
import { CartMirrorResult } from './cart-mirror-result';

const CART_CREATED = 'cart.created';
const CART_UPDATED = 'cart.updated';

/**
 * Ported from storefront-lamp/core/Emr/CartMirror.php. Mirrors the cart to the EMR on every
 * mutation (`[7.10]`): the first call of a journey creates the remote cart, every later one
 * replaces its contents. Inert under this build's Null `CART_GATEWAY` (every call reports `Ok`
 * without reaching a network) — kept for real so `CartController` has the same shape a future
 * real integration slots into.
 *
 * The create/update decision is driven by `JourneyState.cartMirrored` rather than by inspecting
 * the EMR read-model, with one repair: an update against a cart the EMR no longer has (`NotFound`)
 * falls back to a create exactly once. An empty item list is skipped when nothing has been
 * mirrored yet (nothing to say), but sent as an update once something has (`[7.10]`) — that's how
 * "the buyer removed the last line" reaches the EMR at all.
 *
 * Also writes §18's two cart events onto the local audit trail (`cart.created` once, `cart.updated`
 * every time after) — asked of the trail itself via `EventRepository.hasName()`, not of
 * `cartMirrored`, since that flag would make an EMR outage look like a string of first mutations.
 */
@Injectable()
export class CartMirror {
  constructor(
    @Inject(CART_GATEWAY) private readonly gateway: CartGateway,
    private readonly log: OperatorLog,
    private readonly events: EventRepository,
  ) {}

  async mirror(sessionUuid: string | null, cart: Cart, state: JourneyState | null): Promise<void> {
    if (sessionUuid === null) return;

    await this.audit(sessionUuid, cart);

    const mirrored = state?.cartMirrored === true;
    const items = CartMirror.items(cart);
    if (items.length === 0 && !mirrored) return;

    try {
      let result = mirrored ? await this.gateway.update(sessionUuid, items) : await this.gateway.create(sessionUuid, items);

      if (result === CartMirrorResult.NotFound) {
        result = await this.gateway.create(sessionUuid, items);
      }

      if (result !== CartMirrorResult.Ok) {
        this.log.warning('cart.mirror_failed', { session: sessionUuid, items: items.length, outcome: result });
        return;
      }

      if (state !== null) {
        state.cartMirrored = true;
      }
    } catch (e) {
      this.log.warning('cart.mirror_failed', {
        session: sessionUuid,
        items: items.length,
        exception: e instanceof Error ? e.constructor.name : 'unknown',
      });
    }
  }

  private async audit(sessionUuid: string, cart: Cart): Promise<void> {
    const lines = cart.lines().map((line) => ({ product_id: line.emrProductId, slug: line.slug, qty: line.quantity }));
    const name = (await this.events.hasName(sessionUuid, CART_CREATED)) ? CART_UPDATED : CART_CREATED;
    await this.events.append(sessionUuid, name, { lines });
  }

  /** `[7.11]`: EMR product id + name + quantity; lines with no EMR id are skipped, never sent blank. */
  private static items(cart: Cart): CartMirrorItem[] {
    const items: CartMirrorItem[] = [];
    for (const line of cart.lines()) {
      if (!line.emrProductId) continue;
      items.push({
        productId: line.emrProductId,
        ...(line.variantId ? { variantId: line.variantId } : {}),
        name: line.name,
        qty: line.quantity,
      });
    }
    return items;
  }
}

import { Cart } from '../domain/cart';
import { CartLineData } from './journey-state';
import { JourneyStore } from './journey-store';

export interface CartSessionData {
  session: string | null;
  lines: CartLineData[];
  territory: string | null;
}

/** The minimal shape `CartStore` needs off the HTTP session — see `session-data.d.ts`. */
export interface CartCarryingSession {
  cart?: CartSessionData;
  cart_notice?: string;
}

/**
 * Ported from storefront-lamp/core/Journey/CartStore.php. Where the cart actually lives: the
 * session holds the working copy, and every save mirrors it into durable journey state.
 *
 * Two stores rather than one, because each covers the other's hole. Durable journey state is keyed
 * by the analytics session uuid, and there are ordinary deployments with no uuid at all — EMR
 * analytics switched off (this build, always), or an EMR that didn't answer — where a cart kept
 * only there could never be written. The session, conversely, is browser-scoped: it can't serve a
 * cross-device resume.
 *
 * Precedence is decided by the session stamp stored beside the lines, not a flag someone has to
 * remember to set: a mismatched stamp means the browser is carrying a cart from a different
 * session (a resume link, or a re-minted one), so the durable copy for the *current* session wins
 * unless there is nothing there, in which case the anonymous cart is adopted instead of discarded.
 */
export class CartStore {
  private cart: Cart | null = null;

  constructor(
    private readonly journey: JourneyStore,
    private readonly session: CartCarryingSession,
  ) {}

  currentCart(): Cart {
    if (this.cart !== null) return this.cart;

    const uuid = this.journey.sessionUuid();
    const working = this.session.cart ?? null;
    const durable = this.journey.currentState()?.cart ?? { lines: [], territory: null };

    if (working !== null && working.session === uuid) {
      this.cart = Cart.fromArray({ lines: working.lines, territory: working.territory });
      return this.cart;
    }

    if (durable.lines.length > 0) {
      this.cart = Cart.fromArray(durable);
      return this.cart;
    }

    this.cart = working === null ? new Cart() : Cart.fromArray({ lines: working.lines, territory: working.territory });
    return this.cart;
  }

  /**
   * The durable write goes through the journey state object rather than a repository, so it rides
   * the existing save-back (`JourneySaveBackMiddleware`) and a handler still cannot reach the
   * database directly.
   */
  save(cart: Cart): void {
    this.cart = cart;

    const serialised = cart.toArray();
    this.session.cart = { session: this.journey.sessionUuid(), ...serialised };

    const state = this.journey.currentState();
    if (state !== null) {
      state.cart = serialised;
    }
  }

  flash(notice: string): void {
    this.session.cart_notice = notice;
  }

  /** Single-read: the notice is shown on the next page and never again. */
  takeNotice(): string | null {
    const notice = this.session.cart_notice ?? null;
    delete this.session.cart_notice;
    return notice && notice !== '' ? notice : null;
  }
}

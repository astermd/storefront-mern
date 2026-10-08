import { CartGateway, CartMirrorItem } from '../emr/cart-gateway';
import { CartMirrorResult } from '../emr/cart-mirror-result';
import { Boundary } from './boundary';
import { BoundaryTimer } from './boundary-timer';

/**
 * Ported from storefront-lamp/core/Observability/InstrumentedCartGateway.php. `[20.9]` over the
 * cart-mirror boundary.
 *
 * The three mirror outcomes are reported apart rather than as success-or-failure, because
 * `NotFound` is the recoverable one the caller acts on and `Failed` is the one it swallows
 * (`[7.12]`) — collapsing them would hide a remote cart resource that had started answering 404 to
 * everything. The line count goes into the log; the lines do not.
 */
export class InstrumentedCartGateway implements CartGateway {
  constructor(
    private readonly inner: CartGateway,
    private readonly timer: BoundaryTimer,
  ) {}

  async create(session: string, items: CartMirrorItem[]): Promise<CartMirrorResult> {
    return this.mirror('create', session, items, () => this.inner.create(session, items));
  }

  async update(session: string, items: CartMirrorItem[]): Promise<CartMirrorResult> {
    return this.mirror('update', session, items, () => this.inner.update(session, items));
  }

  private async mirror(operation: string, session: string, items: CartMirrorItem[], call: () => Promise<CartMirrorResult>): Promise<CartMirrorResult> {
    return this.timer.measure(Boundary.CartMirror, call, (result) => ({ outcome: result }), { operation, session, items: items.length });
  }
}

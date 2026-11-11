import { AdapterCapabilities } from '../payment/adapter-capabilities';
import { ConsentDefinition } from './consent-definition';
import { Promotion } from './promotion';
import { Totals } from './totals';

export interface CheckoutLineViewModel {
  slug: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  variant_name: string | null;
  image: string | null;
  is_free: boolean;
  is_child: boolean;
}

export interface CheckoutBumpViewModel {
  key: string;
  slug: string;
  headline: string;
  body: string;
  name: string;
  price_cents: number;
  catalog_price_cents: number;
  discounted: boolean;
  image: string | null;
}

export interface CheckoutPlanOption {
  /** True when the variant is sold on a subscription plan, so the picker never labels it billed once. */
  subscription?: boolean;
  id: string;
  name: string;
  price_cents: number;
}

export interface CheckoutSubscriptionOption {
  id: string;
  name: string;
  description: string;
  /** The plan's first payment: what this order charges, not what it renews at. */
  price_cents: number;
}

/** One line's subscription selector: the plans its chosen variant is sold on. */
export interface CheckoutSubscriptionViewModel {
  slug: string;
  name: string;
  variant_name: string;
  chosen: string | null;
  options: CheckoutSubscriptionOption[];
}

export interface CheckoutPlanViewModel {
  slug: string;
  name: string;
  chosen: string | null;
  options: CheckoutPlanOption[];
}

/**
 * Ported from storefront-lamp/core/Checkout/CheckoutViewModel.php. Everything the checkout page
 * renders, assembled once on the server — the template does no resolution of its own.
 *
 * `prefill` is keyed by checkout field name, the same keys `BuyerDetails.toArray()`/`Prefill.from()`
 * use. **The card is never among them** (`[15.8]`): a card echoed into a `value` attribute lands in
 * the browser's back-forward cache and in any proxy that logs response bodies.
 *
 * `postCheckoutSteps` is true when the cart holds two or more prescriptions, whose assessments are
 * completed from the patient portal after the order (`[8.0i]`); the page mentions it without making
 * it sound like a condition of paying.
 *
 * `paymentChallenge` is present only while the payment is waiting on the buyer's bank (`[14.22]`):
 * the value the provider's script on the page needs to run the verification step. It is a secret for
 * at least one provider, so it is rendered into this one response and never stored anywhere.
 */
export class CheckoutViewModel {
  static readonly NOTICE_HOLD = 'hold';

  static readonly NOTICE_CHARGE = 'charge';

  constructor(
    public readonly prefill: Record<string, string>,
    public readonly errors: Record<string, string>,
    public readonly notice: string | null,
    public readonly totals: Totals,
    public readonly lines: CheckoutLineViewModel[],
    public readonly bumps: CheckoutBumpViewModel[],
    /** The first Rx line's variant selector, or null when there is none — kept for anything still reading it. */
    public readonly plans: CheckoutPlanViewModel | null,
    public readonly consents: ConsentDefinition[],
    public readonly capabilities: AdapterCapabilities,
    public readonly promotion: Promotion | null,
    public readonly currency: string,
    public readonly itemCount: number,
    /** Every Rx line's variant selector, in cart order (`[8.0f]`). */
    public readonly planChoices: CheckoutPlanViewModel[] = [],
    public readonly postCheckoutSteps: boolean = false,
    public readonly paymentChallenge: string | null = null,
    /** Every subscription line's plan selector, in cart order. */
    public readonly subscriptionChoices: CheckoutSubscriptionViewModel[] = [],
    /**
     * Which promise the page makes about the money: `NOTICE_HOLD` — funds held until a doctor
     * approves — unless the cart holds a subscription whose plan takes its first payment at once,
     * which is `NOTICE_CHARGE`. A cart with no subscription is always told what it always was.
     */
    public readonly paymentNotice: string = CheckoutViewModel.NOTICE_HOLD,
    /** What the payment adapter will actually do with this order's money, after any narrowing the provider applies. */
    public readonly settlement: string = 'capture',
  ) {}
}

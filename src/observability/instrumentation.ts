import { Injectable } from '@nestjs/common';
import { CheckoutEventReporter } from '../checkout/checkout-event-reporter';
import { CartGateway } from '../emr/cart-gateway';
import { SessionGateway } from '../emr/session-gateway';
import { IntakeGateway } from '../forms/intake-gateway';
import { LeadGateway } from '../forms/lead-gateway';
import { TeleformGateway } from '../forms/teleform-gateway';
import { PaymentAdapter } from '../payment/payment-adapter';
import { BoundaryTimer } from './boundary-timer';
import { InstrumentedCartGateway } from './instrumented-cart-gateway';
import { InstrumentedCheckoutEventReporter } from './instrumented-checkout-event-reporter';
import { InstrumentedIntakeGateway } from './instrumented-intake-gateway';
import { InstrumentedLeadGateway } from './instrumented-lead-gateway';
import { InstrumentedPaymentAdapter } from './instrumented-payment-adapter';
import { InstrumentedSessionGateway } from './instrumented-session-gateway';
import { InstrumentedTeleformGateway } from './instrumented-teleform-gateway';

/**
 * Ported from storefront-lamp/core/Observability/Instrumentation.php. Wraps each port `[20.9]`
 * names in the decorator that times it.
 *
 * One place rather than seven call-site edits, and one place rather than seven `new` expressions
 * in `CoreModule`. Instrumentation that lives at the call sites drifts: the boundary that stops
 * reporting becomes indistinguishable from the boundary that stopped being called — which on this
 * application is the same thing as a funnel that quietly stopped converting (`[20.11]`).
 *
 * Every decorator this class hands back implements the port it wraps and returns exactly what the
 * port returned, which is what makes it safe to leave switched on in production.
 */
@Injectable()
export class Instrumentation {
  constructor(private readonly timer: BoundaryTimer) {}

  sessionGateway(inner: SessionGateway): SessionGateway {
    return new InstrumentedSessionGateway(inner, this.timer);
  }

  cartGateway(inner: CartGateway): CartGateway {
    return new InstrumentedCartGateway(inner, this.timer);
  }

  teleformGateway(inner: TeleformGateway): TeleformGateway {
    return new InstrumentedTeleformGateway(inner, this.timer);
  }

  intakeGateway(inner: IntakeGateway): IntakeGateway {
    return new InstrumentedIntakeGateway(inner, this.timer);
  }

  leadGateway(inner: LeadGateway): LeadGateway {
    return new InstrumentedLeadGateway(inner, this.timer);
  }

  paymentAdapter(inner: PaymentAdapter): PaymentAdapter {
    return new InstrumentedPaymentAdapter(inner, this.timer);
  }

  checkoutEventReporter(inner: CheckoutEventReporter): CheckoutEventReporter {
    return new InstrumentedCheckoutEventReporter(inner, this.timer);
  }
}

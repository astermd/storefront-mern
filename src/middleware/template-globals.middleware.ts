import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { CatalogProvider } from '../catalog/catalog-provider';
import { STEP_ROUTER } from '../core/tokens';
import { Cart } from '../domain/cart';
import { CartLine } from '../domain/cart-line';
import { CartRules } from '../domain/cart-rules';
import { CatalogProduct } from '../domain/product-catalog';
import { StepRouter } from '../domain/step-router';
import { FlowDefinition } from '../funnel/flow-definition';
import { CartStore } from '../journey/cart-store';
import { CartStoreFactory } from '../journey/cart-store-factory';
import { JourneyState } from '../journey/journey-state';
import { JourneyStoreFactory } from '../journey/journey-store-factory';
import { ConfigService } from '../support/config';
import { OperatorLog } from '../support/operator-log';
import { Url } from '../support/url';
import { addTrace } from './trace';

/** What the drawer's assessment button says for each questionnaire step it can send someone to. */
const ASSESSMENT_LABELS: Record<string, string> = {
  prequalification: 'Continue Assessment',
  intake: 'Start Assessment',
  'intake.medical': 'Continue Assessment',
};

/** Steps that replace both drawer actions with a single one of their own. */
const TERMINAL_LABELS: Record<string, string> = {
  not_eligible: 'Review Your Assessment',
  verify: 'Verify Your Identity',
  receipt: 'View Your Order',
};

const CHECKOUT_LABEL = 'Proceed to Checkout';
const MAX_FOOTER_PRODUCTS = 6;

interface CartAction {
  url: string;
  label: string;
}

interface CartActions {
  assessment: CartAction | null;
  checkout: CartAction | null;
  terminal: CartAction | null;
}

const NO_ACTIONS: CartActions = { assessment: null, checkout: null, terminal: null };

/**
 * Full port of storefront-lamp/core/Http/Middleware/TemplateGlobalsMiddleware.php. Publishes
 * request-scoped and config-derived values as template locals (site name/url, the CSRF token, the
 * Maps API key, the footer's treatments column, the current path, and the cart) before the route
 * handler runs.
 *
 * The `cart` global is assembled here — not in each controller — for the same reason
 * `footer_products` is: the mini-cart drawer is included by a partial no controller owns.
 *
 * **Runs before the route handler**, which is why the cart a mutation-handling controller
 * (`CartController`) saves is not the cart this middleware just published — the globals published
 * on a mutating request describe the cart on the way *in*, not the way *out*. That is safe only
 * because `CartController` always answers with a 303 redirect rather than rendering anything
 * itself (see MERN.md's note on the invariant `Phase 5's tests make testable for real) — the
 * response that would show a stale drawer is never rendered, and the GET that follows the redirect
 * rebuilds the globals from the cart the handler actually saved.
 *
 * `structured_data` (`[24.8]`) is deferred to Phase 9 alongside the rest of the SEO subsystem.
 *
 * Pinned slot 9 of 9 — innermost.
 */
@Injectable()
export class TemplateGlobalsMiddleware implements NestMiddleware {
  constructor(
    private readonly config: ConfigService,
    private readonly catalog: CatalogProvider,
    private readonly flow: FlowDefinition,
    private readonly log: OperatorLog,
    private readonly cartStoreFactory: CartStoreFactory,
    @Inject(STEP_ROUTER) private readonly router: StepRouter,
    private readonly journeyStoreFactory: JourneyStoreFactory,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    addTrace(res, 'templateGlobals');

    const path = Url.canonicalizePath(req.path);

    res.locals.site = { name: this.config.app.name, url: this.config.app.url };
    res.locals.app_env = this.config.app.env;
    res.locals.csrf_token = (req as { csrfToken?: string }).csrfToken ?? null;
    res.locals.maps_api_key = this.config.app.features.googleMapsApiKey;
    res.locals.portal_url = this.config.app.portal.url;
    res.locals.footer_products = this.footerProducts();
    res.locals.current_path = path;
    res.locals.cart = this.cartViewModel(path);

    next();
  }

  /** Name/slug pairs for the footer's "Treatments" column, capped at `MAX_FOOTER_PRODUCTS`. */
  private footerProducts(): Array<{ name: string; slug: string }> {
    return this.catalog
      .listedProducts()
      .slice(0, MAX_FOOTER_PRODUCTS)
      .map((product) => ({ name: product.name, slug: product.slug }));
  }

  /** The cart drawer's whole view-model, or an empty one when the store couldn't be built (`[20.1]`). */
  private cartViewModel(path: string) {
    const store = this.resolveCartStore(path);
    if (store === null) {
      return { count: 0, subtotal_cents: 0, notice: null, lines: [] as unknown[], actions: NO_ACTIONS };
    }

    const cart = store.currentCart();

    return {
      count: cart.itemCount(),
      subtotal_cents: cart.subtotalCents(),
      actions: this.cartActions(cart, path),
      // Single-read: shown on the next page and never again.
      notice: store.takeNotice(),
      lines: cart.lines().map((line) => this.lineViewModel(line, cart)),
    };
  }

  private resolveCartStore(path: string): CartStore | null {
    try {
      return this.cartStoreFactory.get();
    } catch (e) {
      this.log.warning('cart.globals_unavailable', { path, reason: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  /** One line's presentation shape — `variant_name`/`image` resolved against the catalog, not the line. */
  private lineViewModel(line: CartLine, cart: Cart) {
    const product = this.catalog.product(line.slug);
    const isChild = line.isChild();

    return {
      slug: line.slug,
      name: line.name,
      kind: line.kind,
      quantity: line.quantity,
      unit_price_cents: line.unitPriceCents,
      line_total_cents: line.lineTotalCents(),
      variant_id: line.variantId,
      variant_name: TemplateGlobalsMiddleware.variantName(product, line.variantId),
      image: product?.image ?? null,
      is_child: isChild,
      parent_name: isChild ? (cart.line(line.parentSlug ?? '')?.name ?? null) : null,
      can_change_quantity: line.kind !== 'rx' && !isChild,
      max_quantity: TemplateGlobalsMiddleware.maxQuantity(product),
    };
  }

  /**
   * What the drawer offers, resolved once for the cart rather than guessed per line. Three shapes:
   * a questionnaire outstanding (both actions, assessment first); a step in `TERMINAL_LABELS` owed
   * (that one action alone); or anything else with a payable cart (checkout alone). A cart the
   * router sends `home` gets nothing — the drawer is on every page, so a link to the page behind it
   * is noise.
   */
  private cartActions(cart: Cart, path: string): CartActions {
    if (cart.isEmpty()) return NO_ACTIONS;

    let state: JourneyState | null;
    try {
      state = this.journeyStoreFactory.get().currentState();
    } catch (e) {
      this.log.warning('cart.drawer_journey_unavailable', {
        path,
        reason: e instanceof Error ? e.constructor.name : 'unknown',
      });
      state = null;
    }

    let step = this.router.nextStep(cart, state);
    if (step === 'home') return NO_ACTIONS;

    if (step in TERMINAL_LABELS) {
      const url = this.stepPath(step);
      return url === null
        ? NO_ACTIONS
        : { assessment: null, checkout: null, terminal: { url, label: TERMINAL_LABELS[step] } };
    }

    // The welcome page is right for a visitor who hasn't started their questionnaire — conditional
    // on the decision having already settled on the intake step, which is the proof no eligibility
    // form is outstanding.
    if (step === 'intake.medical' && (state === null || Object.keys(state.formStatus).length === 0)) {
      step = 'intake';
    }

    const assessmentUrl = step in ASSESSMENT_LABELS ? this.stepPath(step) : null;
    const checkoutUrl = this.stepPath('checkout');

    return {
      assessment: assessmentUrl === null ? null : { url: assessmentUrl, label: ASSESSMENT_LABELS[step] },
      checkout: checkoutUrl === null ? null : { url: checkoutUrl, label: CHECKOUT_LABEL },
      terminal: null,
    };
  }

  /** Null when `step` names no configured funnel step — logged so the gap is visible to an operator. */
  private stepPath(step: string): string | null {
    try {
      return this.flow.pathFor(step);
    } catch {
      this.log.warning('cart.flow_step_missing', { step });
      return null;
    }
  }

  private static variantName(product: CatalogProduct | null, variantId: string | null): string | null {
    if (product === null || variantId === null) return null;
    return product.variants?.find((v) => v.id === variantId)?.name ?? null;
  }

  private static maxQuantity(product: CatalogProduct | null): number {
    if (product?.max_buy_qty && product.max_buy_qty > 0) {
      return Math.max(1, product.max_buy_qty);
    }
    return CartRules.DEFAULT_MAX_QUANTITY;
  }
}

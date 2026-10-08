import { Cart } from '../domain/cart';
import { CartLine } from '../domain/cart-line';
import { ProductCatalog } from '../domain/product-catalog';
import { JourneyState } from '../journey/journey-state';

/**
 * Ported from storefront-lamp/core/Funnel/FunnelRules.php. What a cart and a journey settle
 * between them: whether every prescription can be priced, and which questionnaires are still
 * outstanding.
 *
 * Exists because three collaborators must never disagree: `FunnelRouter` decides where a visitor
 * belongs, `StepPreconditions` decides whether they may enter the step they asked for, and (Phase
 * 6) the intake controller decides which questionnaire a step actually collects. A shared rule is
 * what makes disagreement impossible rather than merely unintended.
 */
export class FunnelRules {
  constructor(private readonly catalog: ProductCatalog) {}

  /** `[12.7]`: an Rx line with no chosen variant cannot be priced or ordered. */
  static everyRxLineHasAPlan(cart: Cart): boolean {
    return cart.lines().every((line) => line.kind !== 'rx' || (line.variantId !== null && line.variantId !== ''));
  }

  /** The dedicated eligibility questionnaires this cart calls for (`[8.2]`), in cart order. */
  prequalificationForms(cart: Cart): string[] {
    return this.forms(cart, 'prequalification_teleform_id', true);
  }

  /** The medical intake questionnaires this cart calls for (`[8.3]`), in cart order. */
  intakeForms(cart: Cart): string[] {
    return this.forms(cart, 'teleform_id', false);
  }

  /** The first eligibility questionnaire this journey has not finished, or null when none is outstanding. */
  outstandingPrequalificationForm(cart: Cart, state: JourneyState | null): string | null {
    return FunnelRules.firstOutstanding(this.prequalificationForms(cart), state);
  }

  /** The first intake questionnaire this journey has not finished, or null when none is outstanding. */
  outstandingIntakeForm(cart: Cart, state: JourneyState | null): string | null {
    return FunnelRules.firstOutstanding(this.intakeForms(cart), state);
  }

  /** The questionnaire the dedicated eligibility step must put on screen, or null when nothing to ask. */
  prequalificationFormToCollect(cart: Cart, state: JourneyState | null): string | null {
    return FunnelRules.formToCollect(this.prequalificationForms(cart), state);
  }

  /** The questionnaire the medical intake step must put on screen, or null when nothing to ask. */
  intakeFormToCollect(cart: Cart, state: JourneyState | null): string | null {
    return FunnelRules.formToCollect(this.intakeForms(cart), state);
  }

  /** Whether `teleformId` is one the dedicated eligibility step collects for this cart. */
  collectedAtPrequalification(teleformId: string, cart: Cart): boolean {
    return this.prequalificationForms(cart).includes(teleformId);
  }

  /**
   * Whether this cart's questionnaires are collected on the storefront at all: true while it holds
   * at most one prescription (`[8.0i]`).
   */
  collectsOnStorefront(cart: Cart): boolean {
    return cart.rxLines().length <= 1;
  }

  /**
   * Whether a product page may offer "Start Assessment" for `slug`: true when the cart would still
   * collect on the storefront with that product in it. A product the catalog does not know adds no
   * prescription.
   */
  assessmentAvailableFor(cart: Cart, slug: string): boolean {
    const prescriptions = cart.rxLines().map((line) => line.slug);
    if (this.catalog.product(slug)?.kind === 'rx') {
      prescriptions.push(slug);
    }

    return new Set(prescriptions).size <= 1;
  }

  /**
   * The prescription a hard stop on `teleformId` is about: the first Rx line whose product declares
   * that form, as its intake or its eligibility questionnaire. With several prescriptions in the
   * cart (`[8.0f]`) this is what keeps "Start Over" from removing a treatment nobody was stopped
   * for; with no declaring line it falls back to the first prescription.
   */
  prescriptionStoppedBy(cart: Cart, teleformId: string | null): CartLine | null {
    const prescriptions = cart.rxLines();
    for (const line of prescriptions) {
      const product = this.catalog.product(line.slug);
      if (teleformId !== null && (product?.teleform_id === teleformId || product?.prequalification_teleform_id === teleformId)) {
        return line;
      }
    }

    return prescriptions[0] ?? null;
  }

  /**
   * Every distinct form the cart's products declare under `field`, deduplicated, or none when the
   * cart is not collected on the storefront.
   */
  private forms(cart: Cart, field: 'teleform_id' | 'prequalification_teleform_id', requiresOptIn: boolean): string[] {
    if (!this.collectsOnStorefront(cart)) {
      return [];
    }

    const forms: string[] = [];
    for (const line of cart.lines()) {
      const product = this.catalog.product(line.slug);
      if (product === null) continue;

      if (requiresOptIn && product.requires_prequalification !== true) continue;

      const id = product[field];
      if (id && !forms.includes(id)) {
        forms.push(id);
      }
    }
    return forms;
  }

  /**
   * Which of `forms` a step has to render — a standing hard stop outranks completion (`[10.43]`),
   * so a form the terminal page still owes the visitor is drawn even if it was already marked
   * complete when a later re-submission tripped a rule.
   */
  private static formToCollect(forms: string[], state: JourneyState | null): string | null {
    const stopped = state !== null && state.isDisqualified() ? state.disqualifiedTeleform : null;
    if (stopped !== null && forms.includes(stopped)) {
      return stopped;
    }
    return FunnelRules.firstOutstanding(forms, state);
  }

  /** The first form in `forms` this journey has not completed — with no journey, every form counts as outstanding. */
  private static firstOutstanding(forms: string[], state: JourneyState | null): string | null {
    for (const id of forms) {
      if (state === null || !state.formCompleted(id)) {
        return id;
      }
    }
    return null;
  }
}

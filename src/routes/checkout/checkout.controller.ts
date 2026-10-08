import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { BuyerDetails } from '../../checkout/buyer-details';
import { CheckoutResult } from '../../checkout/checkout-result';
import { CheckoutService } from '../../checkout/checkout.service';
import { CheckoutViewModel } from '../../checkout/checkout-view-model';
import { CartStoreFactory } from '../../journey/cart-store-factory';
import { PaymentCredential } from '../../payment/payment-credential';
import { RequestContext } from '../../support/request-context';
import { ApplyPromoDto } from './dto/apply-promo.dto';
import { ChoosePlanDto } from './dto/choose-plan.dto';
import { SubmitCheckoutDto } from './dto/submit-checkout.dto';
import { ToggleBumpDto } from './dto/toggle-bump.dto';

const TOO_MANY_REQUESTS = 429;
const CHECKOUT_PATH = '/checkout/';

/**
 * Ported from storefront-lamp/core/Http/Controller/CheckoutController.php. Thin by construction:
 * every method reads the posted body, hands the decision to `CheckoutService`, and either renders
 * the view model or redirects. No rule is evaluated here.
 *
 * **Every sub-action is a native form post that carries the whole form** (`[27.10]`): a bump toggle,
 * a promo apply, a promo remove and a plan switch each repost the buyer's typed contact details,
 * store them in journey state on the way through, and answer with a **303 See Other** back to
 * `/checkout/`.
 *
 * `submit()` is the one method that does not always redirect. A decline, a geo block and a failed
 * validation all re-render the page at 200 with the cart intact and the form re-filled (`[13.30]`,
 * `[13.7]`) — **never the card**.
 */
@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly cartStoreFactory: CartStoreFactory,
  ) {}

  @Get()
  async show(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.render(res, await this.checkout.view());
  }

  /** `[13.5]`, `[13.30]`, `[13.32]`, `[13.37]`. */
  @Post()
  async submit(@Body() body: SubmitCheckoutDto, @Req() req: Request, @Res() res: Response): Promise<void> {
    const buyer = BuyerDetails.fromSubmitted(body as unknown as Record<string, unknown>);

    const result = await this.checkout.submit(buyer, CheckoutController.credentialFrom(body), body.consents ?? {}, RequestContext.fromRequest(req));

    if (result.redirectTo !== null) {
      res.redirect(303, result.redirectTo);
      return;
    }

    // Nest defaults every @Post() handler's status to 201, even with a raw @Res() — and
    // `res.render()` never overrides whatever status is already set. Every non-redirect outcome
    // here is a page render, not a resource creation, so it must say so explicitly.
    res.status(result.refusedBecause === CheckoutResult.REFUSED_RATE_LIMITED ? TOO_MANY_REQUESTS : 200);

    await this.render(res, await this.checkout.view(buyer, result.errors, result.notice));
  }

  /** `[27.10]`, `[27.11]`: the summary changes, the typed form does not. */
  @Post('bump')
  async bump(@Body() body: ToggleBumpDto, @Res() res: Response): Promise<void> {
    this.checkout.rememberBuyer(BuyerDetails.fromSubmitted(body as unknown as Record<string, unknown>));

    const outcome = await this.checkout.toggleBump(body.bump_slug ?? '');
    if (outcome.notice !== null) {
      this.cartStoreFactory.get().flash(outcome.notice);
    }

    res.redirect(303, CHECKOUT_PATH);
  }

  /** `[13.11]`: the provider prices the code; this only records the answer. */
  @Post('promo')
  async promoApply(@Body() body: ApplyPromoDto, @Req() req: Request, @Res() res: Response): Promise<void> {
    this.checkout.rememberBuyer(BuyerDetails.fromSubmitted(body as unknown as Record<string, unknown>));

    const outcome = await this.checkout.applyPromotion(body.discount_code ?? '', RequestContext.fromRequest(req));
    if (outcome.notice !== null) {
      this.cartStoreFactory.get().flash(outcome.notice);
    }

    res.redirect(303, CHECKOUT_PATH);
  }

  /** `[13.13]`: removing the code removes the discount, and nothing else. */
  @Post('promo/remove')
  removePromo(@Body() body: ApplyPromoDto, @Res() res: Response): void {
    this.checkout.rememberBuyer(BuyerDetails.fromSubmitted(body as unknown as Record<string, unknown>));
    this.checkout.removePromotion();

    res.redirect(303, CHECKOUT_PATH);
  }

  /**
   * `[12.4]`, `[12.7]`: switching the plan re-prices the Rx line it names.
   *
   * An order may carry several prescriptions (`[8.0f]`), so each picker's radio posts
   * `plan[<slug>]=<variant>` and names its own line. The older `slug` + `variant_id` pair is still
   * read when `plan` is absent, so a submission from before that keeps working.
   */
  @Post('plan')
  plan(@Body() body: ChoosePlanDto, @Res() res: Response): void {
    this.checkout.rememberBuyer(BuyerDetails.fromSubmitted(body as unknown as Record<string, unknown>));

    let slug = body.slug ?? '';
    let variantId = body.variant_id ?? '';
    const planEntries = body.plan && typeof body.plan === 'object' ? Object.entries(body.plan) : [];
    if (planEntries.length === 1) {
      [slug, variantId] = planEntries[0];
    }

    const outcome = this.checkout.choosePlan(slug, variantId);
    if (outcome.notice !== null) {
      this.cartStoreFactory.get().flash(outcome.notice);
    }

    res.redirect(303, CHECKOUT_PATH);
  }

  private async render(res: Response, view: CheckoutViewModel): Promise<void> {
    res.render('pages/checkout', { noindex: true, checkout: view });
  }

  /**
   * The card, straight from the body and nowhere else. The expiry arrives as one `MM / YY` box; a
   * two-digit year is expanded to four in this century. Nothing here validates the number — that
   * stays entirely the provider's to answer (`[13.28]`); `CardNumber.problem()` (called inside
   * `CheckoutService.submit()`, alongside the other corrections) refuses only a number of no issued
   * length.
   */
  private static credentialFrom(body: SubmitCheckoutDto): PaymentCredential {
    const [month, year] = CheckoutController.expiry((body.card_expiry ?? '').toString());
    return PaymentCredential.card((body.card_number ?? '').toString(), month, year, (body.card_cvc ?? '').toString());
  }

  private static expiry(raw: string): [string, string] {
    const match = /^\s*(\d{1,2})\s*[/\-\s]\s*(\d{2}|\d{4})\s*$/.exec(raw);
    if (match === null) return ['', ''];

    const [, monthPart, yearPart] = match;
    const year = yearPart.length === 2 ? `${new Date().getFullYear().toString().slice(0, 2)}${yearPart}` : yearPart;

    return [monthPart.padStart(2, '0'), year];
  }
}

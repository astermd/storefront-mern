import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CartRules } from '../../domain/cart-rules';
import { STEP_ROUTER } from '../../core/tokens';
import { StepRouter } from '../../domain/step-router';
import { CartMirror } from '../../emr/cart-mirror';
import { FlowDefinition } from '../../funnel/flow-definition';
import { CartStoreFactory } from '../../journey/cart-store-factory';
import { JourneyStoreFactory } from '../../journey/journey-store-factory';
import { safePath } from '../../support/safe-path';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { RemoveFromCartDto } from './dto/remove-from-cart.dto';
import { SetQuantityDto } from './dto/set-quantity.dto';

/**
 * Ported from storefront-lamp/core/Http/Controller/CartController.php. Every response here is a
 * **303 See Other** — never 200 — which is the invariant `TemplateGlobalsMiddleware`'s cart
 * globals rely on (see that middleware's doc comment): a mutation response is never rendered, so
 * a stale drawer snapshot is never shown.
 */
@Controller('cart')
export class CartController {
  static readonly INVALID_QUANTITY = 'Enter a valid quantity.';

  constructor(
    private readonly rules: CartRules,
    private readonly cartStoreFactory: CartStoreFactory,
    private readonly mirror: CartMirror,
    @Inject(STEP_ROUTER) private readonly router: StepRouter,
    private readonly flow: FlowDefinition,
    private readonly journeyStoreFactory: JourneyStoreFactory,
  ) {}

  @Post('add')
  async add(@Body() body: AddToCartDto, @Req() req: Request, @Res() res: Response): Promise<void> {
    const store = this.cartStoreFactory.get();
    const cart = store.currentCart();

    const outcome = this.rules.add(cart, body.slug ?? '', body.variant_id ?? null, Math.max(1, body.quantity ?? 1));

    if (outcome.notice !== null) {
      store.flash(outcome.notice);
    }

    if (!outcome.accepted) {
      res.redirect(303, safePath(body.return_to));
      return;
    }

    const state = this.journeyStoreFactory.get().currentState();
    store.save(cart);
    await this.mirror.mirror(CartController.sessionUuid(req), cart, state);

    const step = body.intent === 'checkout' ? 'checkout' : this.router.nextStep(cart, state);
    res.redirect(303, this.flow.pathFor(step));
  }

  @Post('remove')
  async remove(@Body() body: RemoveFromCartDto, @Req() req: Request, @Res() res: Response): Promise<void> {
    const store = this.cartStoreFactory.get();
    const cart = store.currentCart();

    const outcome = this.rules.remove(cart, body.slug ?? '');

    if (outcome.notice !== null) {
      store.flash(outcome.notice);
    }

    if (outcome.accepted) {
      const state = this.journeyStoreFactory.get().currentState();
      store.save(cart);
      await this.mirror.mirror(CartController.sessionUuid(req), cart, state);
    }

    // Always redirects here — removal never advances the funnel, unlike add().
    res.redirect(303, safePath(body.return_to));
  }

  @Post('quantity')
  async quantity(@Body() body: SetQuantityDto, @Req() req: Request, @Res() res: Response): Promise<void> {
    const store = this.cartStoreFactory.get();

    const rawQuantity = body.quantity;
    if (!CartController.isNumeric(rawQuantity)) {
      store.flash(CartController.INVALID_QUANTITY);
      res.redirect(303, safePath(body.return_to));
      return;
    }

    const cart = store.currentCart();
    const outcome = this.rules.setQuantity(cart, body.slug ?? '', Math.trunc(Number(rawQuantity)));

    if (outcome.notice !== null) {
      store.flash(outcome.notice);
    }

    if (outcome.accepted) {
      const state = this.journeyStoreFactory.get().currentState();
      store.save(cart);
      await this.mirror.mirror(CartController.sessionUuid(req), cart, state);
    }

    res.redirect(303, safePath(body.return_to));
  }

  private static sessionUuid(req: Request): string | null {
    return (req as { sessionUuid?: string | null }).sessionUuid ?? null;
  }

  /** PHP's `is_numeric()` — a numeric string ("2", "-1", "1.5") or an actual number, never `null`/objects. */
  private static isNumeric(value: unknown): boolean {
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'string' || value.trim() === '') return false;
    return !Number.isNaN(Number(value));
  }
}

import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { FlowDefinition } from '../../funnel/flow-definition';
import { CartStoreFactory } from '../../journey/cart-store-factory';
import { RequestContext } from '../../support/request-context';
import { UpsellResult } from '../../upsell/upsell-result';
import { UpsellService } from '../../upsell/upsell-service';

/**
 * Ported from storefront-lamp/core/Http/Controller/UpsellController.php. The upsell step's HTTP
 * surface: the offer, and the two answers to it.
 *
 * Thin by construction, the same way `CartController`/`CheckoutController` are — nothing is decided
 * here. Every method answers with a **303 See Other**, so a reload replays the GET rather than
 * reposting a charge.
 */
@Controller('upsell')
export class UpsellController {
  constructor(
    private readonly upsells: UpsellService,
    private readonly cartStoreFactory: CartStoreFactory,
    private readonly flow: FlowDefinition,
  ) {}

  /** The offer, or the receipt when there is nothing left to offer (`[16.3]`, `[16.5]`, `[16.6]`). */
  @Get()
  show(@Res() res: Response): void {
    const view = this.upsells.view();

    if (view === null) {
      res.redirect(303, this.receiptPath());
      return;
    }

    res.render('pages/upsell', { noindex: true, upsell: view });
  }

  /** `[16.8]`, `[16.11]`: the charge is attempted, and the buyer moves on either way. */
  @Post('accept')
  async accept(@Body() body: { upsell_key?: string }, @Req() req: Request, @Res() res: Response): Promise<void> {
    const answering = typeof body.upsell_key === 'string' ? body.upsell_key : '';
    const result = await this.upsells.accept(RequestContext.fromRequest(req), answering);
    this.answer(res, result);
  }

  /** `[16.9]`: no charge, no provider call, next offer. */
  @Post('decline')
  async decline(@Body() body: { upsell_key?: string }, @Res() res: Response): Promise<void> {
    const answering = typeof body.upsell_key === 'string' && body.upsell_key !== '' ? body.upsell_key : null;
    const result = await this.upsells.decline(answering);
    this.answer(res, result);
  }

  /** The result decides the response and nothing else does — a notice is flashed, since the answer is always a redirect. */
  private answer(res: Response, result: UpsellResult): void {
    if (result.notice !== null) {
      this.cartStoreFactory.get().flash(result.notice);
    }

    res.redirect(303, result.redirectTo);
  }

  private receiptPath(): string {
    return this.flow.allSteps()['receipt'] !== undefined ? this.flow.pathFor('receipt') : this.flow.pathFor(FlowDefinition.ENTRY_STEP);
  }
}

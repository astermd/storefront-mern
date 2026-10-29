import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ADDRESS_AUTOFILL } from '../../core/tokens';
import { AddressAutofill } from '../../emr/address-autofill';
import { DatabaseRateLimiter } from '../../support/database-rate-limiter';
import { RequestContext } from '../../support/request-context';

const BUCKET = 'checkout.address';

/** Below this the EMR answers addresses from anywhere, and the call buys nothing. */
const MIN_LENGTH = 3;

const MAX_LENGTH = 200;

/**
 * Ported from storefront-lamp/core/Http/Controller/AddressController.php. `/checkout/address/
 * suggest/` and `/checkout/address/resolve/` — the checkout address field's suggestions when the
 * deployment has no Google Maps key of its own.
 *
 * The browser asks the storefront rather than the EMR because the EMR call needs this deployment's
 * credential, which never reaches a page.
 *
 * **GETs, and so outside the CSRF check.** Both read and change nothing, and what they answer is
 * public address data. They are rate-limited per client address instead, because each one spends
 * an EMR call: typing an address is a dozen of them, so the bucket is sized for several honest
 * attempts and stops a script.
 *
 * Every refusal and every failure answers an empty result with a 200, apart from the rate limit's
 * 429. The script treats both the same way — no dropdown — and the buyer keeps typing.
 */
@Controller('checkout/address')
export class AddressController {
  constructor(
    @Inject(ADDRESS_AUTOFILL) private readonly autofill: AddressAutofill,
    private readonly limiter: DatabaseRateLimiter,
  ) {}

  @Get('suggest')
  async suggest(@Req() req: Request, @Res() res: Response): Promise<void> {
    const search = AddressController.text(req.query.q);

    if (search === null) {
      AddressController.json(res, 200, { suggestions: [] });
      return;
    }

    if (!(await this.allowed(req))) {
      AddressController.json(res, 429, { suggestions: [] });
      return;
    }

    AddressController.json(res, 200, { suggestions: (await this.autofill.suggest(search)) ?? [] });
  }

  @Get('resolve')
  async resolve(@Req() req: Request, @Res() res: Response): Promise<void> {
    const address = AddressController.text(req.query.address);

    if (address === null) {
      AddressController.json(res, 200, { address: null });
      return;
    }

    if (!(await this.allowed(req))) {
      AddressController.json(res, 429, { address: null });
      return;
    }

    AddressController.json(res, 200, { address: await this.autofill.resolve(address) });
  }

  private allowed(req: Request): Promise<boolean> {
    return this.limiter.allow(BUCKET, RequestContext.fromRequest(req).clientIp ?? 'unknown');
  }

  /** The trimmed parameter, or null when it is missing, too short to be worth a call, or too long to be an address. */
  private static text(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    const length = [...trimmed].length;

    return length < MIN_LENGTH || length > MAX_LENGTH ? null : trimmed;
  }

  private static json(res: Response, status: number, data: Record<string, unknown>): void {
    res.status(status).set('Cache-Control', 'no-store').json(data);
  }
}

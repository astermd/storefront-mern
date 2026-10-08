import { Controller, Get, NotFoundException, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CatalogProvider } from '../../catalog/catalog-provider';
import { FunnelRules } from '../../funnel/funnel-rules';
import { CartStoreFactory } from '../../journey/cart-store-factory';
import { StructuredData } from '../../seo/structured-data/structured-data';

/**
 * Ported from storefront-lamp/core/Http/Controller/ProductDetailController.php.
 *
 * `assessment_available` is false when adding this product would leave the cart with two or more
 * prescriptions, which collect no questionnaire on the storefront (`[8.0i]`) — the page then offers
 * checkout alone. A cart that cannot be read leaves the page as it is for everyone else: the button
 * is a convenience, and the routing decision behind it applies the rule anyway.
 */
@Controller('products')
export class ProductDetailController {
  private readonly funnel: FunnelRules;

  constructor(
    private readonly catalog: CatalogProvider,
    private readonly structuredData: StructuredData,
    private readonly cartStoreFactory: CartStoreFactory,
  ) {
    this.funnel = new FunnelRules(catalog);
  }

  @Get(':slug')
  detail(@Param('slug') slug: string, @Req() req: Request, @Res() res: Response): void {
    const product = this.catalog.product(slug ?? '');
    if (product === null) {
      throw new NotFoundException();
    }

    res.render('pages/product', {
      product,
      structured_data: this.structuredData.json(req.path),
      assessment_available: this.assessmentAvailable(slug),
    });
  }

  private assessmentAvailable(slug: string): boolean {
    try {
      return this.funnel.assessmentAvailableFor(this.cartStoreFactory.get().currentCart(), slug);
    } catch {
      return true;
    }
  }
}

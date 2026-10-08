import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CatalogProvider } from '../../catalog/catalog-provider';
import { StructuredData } from '../../seo/structured-data/structured-data';

/** Ported from storefront-lamp/core/Http/Controller/HomeController.php. */
@Controller()
export class HomeController {
  constructor(
    private readonly catalog: CatalogProvider,
    private readonly structuredData: StructuredData,
  ) {}

  @Get()
  home(@Req() req: Request, @Res() res: Response): void {
    res.render('pages/home', {
      featured_products: this.catalog.listedProducts().slice(0, 6),
      structured_data: this.structuredData.json(req.path),
    });
  }
}

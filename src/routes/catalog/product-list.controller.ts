import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CatalogProvider } from '../../catalog/catalog-provider';
import { StructuredData } from '../../seo/structured-data/structured-data';

@Controller('treatments')
export class ProductListController {
  constructor(
    private readonly catalog: CatalogProvider,
    private readonly structuredData: StructuredData,
  ) {}

  @Get()
  list(@Req() req: Request, @Res() res: Response): void {
    res.render('pages/treatments', {
      products: this.catalog.listedProducts(),
      categories: this.catalog.categories(),
      structured_data: this.structuredData.json(req.path),
    });
  }
}

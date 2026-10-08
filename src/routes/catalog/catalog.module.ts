import { Module } from '@nestjs/common';
import { ProductDetailController } from './product-detail.controller';
import { ProductListController } from './product-list.controller';

@Module({
  controllers: [ProductListController, ProductDetailController],
})
export class CatalogModule {}

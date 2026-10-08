import { Module } from '@nestjs/common';
import { RobotsController } from './robots.controller';
import { SitemapController } from './sitemap.controller';

@Module({
  controllers: [RobotsController, SitemapController],
})
export class SeoModule {}

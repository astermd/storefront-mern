import { Module } from '@nestjs/common';
import { UpsellQueue } from '../../upsell/upsell-queue';
import { UpsellService } from '../../upsell/upsell-service';
import { UpsellController } from './upsell.controller';

@Module({
  controllers: [UpsellController],
  providers: [UpsellQueue, UpsellService],
})
export class UpsellModule {}

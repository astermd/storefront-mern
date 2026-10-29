import { Module } from '@nestjs/common';
import { CheckoutService } from '../../checkout/checkout.service';
import { AddressController } from './address.controller';
import { CheckoutController } from './checkout.controller';

@Module({
  controllers: [CheckoutController, AddressController],
  providers: [CheckoutService],
})
export class CheckoutModule {}

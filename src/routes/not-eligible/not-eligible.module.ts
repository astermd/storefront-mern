import { Module } from '@nestjs/common';
import { NotEligibleController } from './not-eligible.controller';

@Module({
  controllers: [NotEligibleController],
})
export class NotEligibleModule {}

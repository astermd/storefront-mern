import { Module } from '@nestjs/common';
import { Completion } from '../../completion/completion';
import { ReceiptController } from './receipt.controller';

@Module({
  controllers: [ReceiptController],
  providers: [Completion],
})
export class ReceiptModule {}

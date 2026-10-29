import { Module } from '@nestjs/common';
import { IntakeController } from './intake.controller';
import { IntakeUploadController } from './intake-upload.controller';

@Module({
  controllers: [IntakeController, IntakeUploadController],
})
export class IntakeModule {}

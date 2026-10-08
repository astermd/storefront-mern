import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
loadDotenv();

import { CommandFactory } from 'nest-commander';
import { ConsoleModule } from './console.module';

async function bootstrap(): Promise<void> {
  await CommandFactory.run(ConsoleModule, { logger: ['error', 'warn'] });
}

void bootstrap();

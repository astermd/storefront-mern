import { Injectable } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

/**
 * Builds the `PrismaClient` bound behind `DATABASE_CONNECTION` in `CoreModule`. Unlike the
 * Kysely-based version this replaced, there is no dialect switch here: `schema.prisma`'s
 * `datasource` block fixes the engine at `prisma generate` time.
 *
 * Prisma 7 removed the "no adapter" mode entirely — `PrismaClient` no longer reads a connection
 * string from `DATABASE_URL` on its own, so a driver adapter is mandatory even for the simplest
 * case. `PrismaBetterSqlite3` is that adapter for the `sqlite` engine `schema.prisma` names; the
 * CLI (`prisma migrate`/`prisma generate`) gets its own copy of `DATABASE_URL` through
 * `prisma.config.ts` instead, since it never goes through this class at all.
 */
@Injectable()
export class ConnectionFactory {
  create(): PrismaClient {
    const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? '' });
    return new PrismaClient({ adapter });
  }
}

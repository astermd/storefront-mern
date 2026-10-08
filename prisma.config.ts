import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7's CLI configuration — the connection string `prisma migrate`/`prisma generate` use.
 * Separate from how the *application* connects (`src/database/connection-factory.ts`, which passes
 * a driver adapter to `PrismaClient`'s own constructor instead) since Prisma 7 removed
 * `schema.prisma`'s inline `datasource.url` entirely — see that schema file's doc comment.
 *
 * `import 'dotenv/config'` first: the Prisma CLI doesn't load `.env` on its own the way earlier
 * major versions did, and `env()` below throws if the variable it names isn't already set.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});

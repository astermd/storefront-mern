import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Command, CommandRunner } from 'nest-commander';
import { OperatorLog } from '../support/operator-log';

const execFileAsync = promisify(execFile);

/**
 * Ported from storefront-lamp's `bin/console db:migrate`. Runs through the same `nest-commander`
 * application context as the web process (`CommandFactory.run(ConsoleModule)` in `console/main.ts`
 * imports `AppModule`, not a second bootstrap path) — see MERN.md's Toolchain table.
 *
 * Shells out to Prisma's own migration runner (`prisma migrate deploy`) rather than driving
 * migrations through `DATABASE_CONNECTION` directly — Prisma's migration history and its
 * `_prisma_migrations` tracking table are owned entirely by the Prisma CLI, not by application
 * code, since Phase 3's original hand-rolled `Migrator` was replaced by Prisma (see MERN.md's
 * Persistence section).
 */
@Command({ name: 'db:migrate', description: 'Apply pending database migrations' })
export class DbMigrateCommand extends CommandRunner {
  constructor(private readonly log: OperatorLog) {
    super();
  }

  async run(): Promise<void> {
    try {
      const { stdout } = await execFileAsync('npx', ['prisma', 'migrate', 'deploy'], {
        cwd: process.cwd(),
        env: process.env,
      });
      console.log(stdout.trim());
      this.log.info('db.migrated', {});
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(message);
      this.log.error('db.migrate_failed', { message });
      process.exitCode = 1;
    }
  }
}

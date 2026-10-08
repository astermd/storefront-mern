import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { AbandonmentCommand } from './abandonment.command';
import { CacheClearCommand } from './cache-clear.command';
import { CaptureOrderCommand } from './capture-order.command';
import { ConfigValidateCommand } from './config-validate.command';
import { DbMigrateCommand } from './db-migrate.command';
import { EmrPingCommand } from './emr-ping.command';
import { FormsCachePurgeCommand } from './forms-cache-purge.command';
import { FormsRecordCommand } from './forms-record.command';
import { MediaPruneCommand } from './media-prune.command';
import { OpsStatusCommand } from './ops-status.command';
import { ProviderPingCommand } from './provider-ping.command';
import { PruneCommand } from './prune.command';
import { ReconcileCommand } from './reconcile.command';
import { ReconcileOrdersCommand } from './reconcile-orders.command';
import { ThemeSyncCommand } from './theme-sync.command';

/**
 * `npm run console -- <command>` runs through this module rather than a second, parallel wiring
 * path — it imports `CoreModule` the same way `AppModule` does, so a console command shares
 * exactly the same DI bindings (Null-bound ports included) as the web process. See MERN.md's
 * Toolchain table: "every command runs inside the same Nest application context as the web
 * process, not a second bootstrap path."
 *
 * Phase 10 completes the console roster: `theme:sync`/`media:prune` are honest no-ops (see their
 * own doc comments — they depend on catalog-sync infrastructure this port never built);
 * `emr:ping`/`provider:ping`/`cache:clear`/`forms:cache-purge`/`config:validate` are real;
 * `abandonment:signals`/`db:prune`/`emr:reconcile`/`provider:reconcile`/`ops:status` are real,
 * DB-driven sweeps.
 */
@Module({
  imports: [CoreModule],
  providers: [
    DbMigrateCommand,
    AbandonmentCommand,
    PruneCommand,
    ReconcileCommand,
    ReconcileOrdersCommand,
    OpsStatusCommand,
    ThemeSyncCommand,
    MediaPruneCommand,
    EmrPingCommand,
    ProviderPingCommand,
    CacheClearCommand,
    FormsCachePurgeCommand,
    ConfigValidateCommand,
    CaptureOrderCommand,
    FormsRecordCommand,
  ],
})
export class ConsoleModule {}

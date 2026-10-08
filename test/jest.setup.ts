// Runs before any test module loads. `CoreModule` eagerly constructs `DATABASE_CONNECTION` at
// module init (Nest instantiates every registered provider regardless of whether a given test
// injects it — see the plan file's "Corrections found during implementation"), so without this,
// every e2e test that boots `AppModule`/`CoreModule` would silently open the real dev SQLite file
// at `storage/database/app.sqlite3` instead of an isolated database. Defaults only — a test that
// wants a real file (`test/database.spec.ts` builds its own Kysely instance directly) is
// unaffected.
process.env.DB_DRIVER ??= 'sqlite';
process.env.DB_DATABASE ??= ':memory:';

// See test/support/no-network.ts's own doc comment: defense-in-depth, not the primary guarantee —
// every gateway/adapter is expected to refuse the network under NODE_ENV=test on its own already.
import { installNoNetworkGuard } from './support/no-network';
installNoNetworkGuard();

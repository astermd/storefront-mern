import { Injectable, Scope } from '@nestjs/common';
import { SessionRepository } from '../repository/session-repository';
import { JourneyStore } from './journey-store';

/**
 * Nest's first-class equivalent of "attach it to `req` and read it off `req` everywhere else" —
 * see MERN.md's "The container is Nest's own DI" section. `Scope.REQUEST` means Nest builds a
 * fresh injector subtree per request for this branch of the graph, so a middleware and a
 * controller that both inject `JourneyStoreFactory` see the **same** `JourneyStore` instance for
 * the lifetime of one request, matching the PHP container's "closure resolves to one instance per
 * container" guarantee.
 *
 * Deviates from MERN.md's own illustrative snippet in one respect: that snippet injects
 * `DATABASE_CONNECTION` directly and builds a `JourneyStore` over it. `DATABASE_CONNECTION` has no
 * binding until Phase 3, so this injects `SessionRepository` instead (Phase 2's in-memory stand-in
 * — see its doc comment) — `JourneyStore`'s own constructor already expects a `SessionRepository`,
 * so nothing here changes when Phase 3 swaps that repository's internals for real Kysely queries.
 */
@Injectable({ scope: Scope.REQUEST })
export class JourneyStoreFactory {
  private store: JourneyStore | null = null;

  constructor(private readonly sessions: SessionRepository) {}

  get(): JourneyStore {
    if (this.store === null) {
      this.store = new JourneyStore(this.sessions);
    }
    return this.store;
  }
}

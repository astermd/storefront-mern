import { Injectable, Scope } from '@nestjs/common';
import { SessionRepository } from '../repository/session-repository';
import { JourneyStore } from './journey-store';

/**
 * Nest's first-class equivalent of "attach it to `req` and read it off `req` everywhere else" —
 * see docs/STACK.md's "The container" section. `Scope.REQUEST` means Nest builds a fresh injector
 * subtree per request for this branch of the graph, so a middleware and a controller that both
 * inject `JourneyStoreFactory` see the **same** `JourneyStore` instance for the lifetime of one
 * request.
 *
 * Injects `SessionRepository` rather than `DATABASE_CONNECTION`: `JourneyStore`'s own constructor
 * expects a `SessionRepository`, which owns every query against the `sessions` table.
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

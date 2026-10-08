import { SessionRepository } from '../repository/session-repository';
import { JourneyState, JourneyStateData } from './journey-state';
import { JourneyWriteFailed } from './journey-write-failed';

/**
 * Ported from storefront-lamp/core/Journey/JourneyStore.php. Request-scoped access to the current
 * journey's durable state: load it once, hand the same instance to everyone who asks, and write it
 * back once at the end of the request.
 *
 * The write-back compares a fingerprint taken at load time rather than trusting callers to flag
 * mutations, because the failure mode of a missed dirty flag is silent data loss on a step the
 * visitor believes they completed. Loading a session this storefront has never seen creates the
 * row, which is what makes an adopted resume link work on a fresh deployment.
 *
 * **Optimistic concurrency, added after a real, live lost-update was confirmed.** This storefront
 * writes the *whole* journey state on every flush — there is no per-field update — so two requests
 * for the same session that each read-modify-write independently can race: whichever's write
 * lands last wins outright, discarding whatever the other had just added. This is not theoretical:
 * a slow intake save (its own `IntakeSession.save()` makes a real EMR call partway through) was
 * still being processed when a checkout page visit, for the same session, read the row, built its
 * own `JourneyState` from that (older) snapshot, and later flushed it back *after* the slow save's
 * own flush had already landed the new answers — silently overwriting them with its own, staler
 * copy. `flush()` now guards its write on the row's `updatedAt` as it stood when this journey was
 * loaded, and on a conflict, re-reads the row and retries once, replaying only the top-level
 * fields *this* request actually changed onto the fresh copy rather than the whole snapshot it
 * started from — see `flush()`'s own doc comment for why a whole-object overwrite on retry would
 * just move the same race one step later instead of closing it.
 */
export class JourneyStore {
  private uuid: string | null = null;
  private state: JourneyState | null = null;
  private fingerprint: string | null = null;
  /** The row's `updatedAt` as of `load()`/`adopt()` — the optimistic-concurrency token `flush()` writes against. */
  private loadedAt: string | null = null;
  /** A snapshot of every field at load time, so a conflict retry can tell which ones *this* request actually touched. */
  private loadedSnapshot: JourneyStateData | null = null;

  constructor(private readonly sessions: SessionRepository) {}

  async load(uuid: string): Promise<JourneyState> {
    if (this.uuid === uuid && this.state !== null) {
      return this.state;
    }

    const row = await this.sessions.find(uuid);
    if (row === null) {
      const updatedAt = await this.sessions.insert(uuid, {}, null);
      const state = JourneyState.fromArray({}, null, null);
      this.adopt(uuid, state, updatedAt);
      return state;
    }

    const state = JourneyState.fromArray(row.journeyState, row.attribution, row.opportunityId);
    this.adopt(uuid, state, row.updatedAt);
    return state;
  }

  /**
   * Registers an already-built state (a session minted on this request, or freshly loaded).
   *
   * @param updatedAt the row's optimistic-concurrency token, or `null` for a state that was never
   *   actually read from a row (a fresh mint) — there is nothing yet for a concurrent reader to
   *   race against, so `flush()` skips the check for exactly this case rather than refusing a
   *   write no row exists to conflict with.
   */
  adopt(uuid: string, state: JourneyState, updatedAt: string | null = null): void {
    this.uuid = uuid;
    this.state = state;
    this.fingerprint = state.fingerprint();
    this.loadedAt = updatedAt;
    this.loadedSnapshot = state.toArray();
  }

  currentState(): JourneyState | null {
    return this.state;
  }

  sessionUuid(): string | null {
    return this.uuid;
  }

  /**
   * Persists the journey if anything changed.
   *
   * @throws JourneyWriteFailed when the row this journey belongs to is gone — raised rather than
   * returned, so it reaches `JourneySaveBackMiddleware`, which logs it and swallows it: a lost
   * analytics write must not become the visitor's problem (`[20.1]`). Leaving the fingerprint
   * untouched on failure means a later flush in the same request tries again.
   */
  async flush(): Promise<void> {
    if (this.uuid === null || this.state === null) return;

    const current = this.state.fingerprint();
    if (current === this.fingerprint) return;

    const attempt = await this.sessions.save(this.uuid, this.state.toArray(), this.state.attribution?.toArray() ?? null, this.state.opportunityId, this.loadedAt);

    if (attempt.outcome === 'ok') {
      this.fingerprint = current;
      this.loadedAt = attempt.updatedAt;
      this.loadedSnapshot = this.state.toArray();
      return;
    }

    if (attempt.outcome === 'not_found') {
      throw new JourneyWriteFailed(`Journey row for session ${this.uuid} no longer exists.`);
    }

    // 'conflict': someone else wrote since this journey was loaded. Re-read the row they wrote,
    // and replay onto it only the top-level fields *this* request actually changed — a whole
    // snapshot from this request's own (now-stale) load time would silently re-discard whatever
    // that other write added, just one step later than the bug this exists to close.
    const fresh = await this.sessions.find(this.uuid);
    if (fresh === null) {
      throw new JourneyWriteFailed(`Journey row for session ${this.uuid} no longer exists.`);
    }

    const mine = this.state.toArray();
    const merged: JourneyStateData = { ...JourneyState.fromArray(fresh.journeyState, fresh.attribution, fresh.opportunityId).toArray() };
    for (const key of Object.keys(mine) as Array<keyof JourneyStateData>) {
      if (this.loadedSnapshot === null || JSON.stringify(mine[key]) !== JSON.stringify(this.loadedSnapshot[key])) {
        (merged[key] as unknown) = mine[key];
      }
    }

    const retry = await this.sessions.save(this.uuid, merged, merged.attribution, merged.opportunityId, fresh.updatedAt);
    if (retry.outcome !== 'ok') {
      throw new JourneyWriteFailed(`Journey row for session ${this.uuid} could not be saved after a conflict retry.`);
    }

    this.fingerprint = JourneyState.fromArray(merged, merged.attribution, merged.opportunityId).fingerprint();
    this.loadedAt = retry.updatedAt;
    this.loadedSnapshot = merged;
  }
}

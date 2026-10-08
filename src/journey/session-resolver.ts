import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { SESSION_GATEWAY } from '../core/tokens';
import { OperatorLog } from '../support/operator-log';
import { Attribution } from './attribution';
import { JourneyState } from './journey-state';
import { JourneyStore } from './journey-store';
import { SessionGateway } from '../emr/session-gateway';
import { SessionOptions } from './session-options';
import { SessionResolution } from './session-resolution';

/**
 * Reduced port of storefront-lamp/core/Journey/SessionResolver.php for Phase 2. Decides which
 * analytics session this request belongs to, and captures first-touch attribution while doing it.
 *
 * The full PHP original additionally: adopts a session named by a signed resume link (`[21.3]`),
 * decrypts an encrypted `_amd` attribution payload, and — the biggest piece — re-validates an
 * existing cookie against the EMR on a schedule and transplants the whole journey onto a freshly
 * minted session when the EMR no longer recognises it (`remint()`, carrying roughly twenty durable
 * fields across). None of that is reachable in an honest way yet: resume links and `_amd`
 * decryption need the `Attribution`/`AmdPayload` machinery this phase doesn't build, and
 * EMR-reconciliation-driven remint needs the full `JourneyState` field set the PHP `remint()`
 * copies (Phases 4/6/7/8) regardless of `SESSION_GATEWAY`'s binding — `EmrSessionGateway` now
 * really does mint and look up sessions against `@astermd-hq/sdk` when `config.app.session.
 * analytics` is on (see `core/core.module.ts`), and under `NullSessionGateway` (analytics off, or
 * `NODE_ENV=test`) `create()` still always answers null and `view()` still always answers "doesn't
 * exist," so no session is ever minted or kept alive across requests in that binding. What remains
 * here (cookie-present -> trust it; no cookie + may-mint -> attempt a real mint; anything else ->
 * no session) is what's left worth being faithful to until the remint/resume-link paths land.
 */
@Injectable()
export class SessionResolver {
  constructor(
    @Inject(SESSION_GATEWAY) private readonly gateway: SessionGateway,
    private readonly log: OperatorLog,
    private readonly options: SessionOptions,
  ) {}

  async resolve(request: Request, journey: JourneyStore, mayCreate: boolean): Promise<SessionResolution> {
    const incoming = this.captureAttribution(request);

    const cookies = (request as { cookies?: Record<string, string> }).cookies ?? {};
    const cookie = SessionResolver.validUuid(cookies[this.options.cookieName] ?? '');

    if (cookie !== null) {
      const state = await journey.load(cookie);
      state.attribution = Attribution.firstTouch(state.attribution, incoming);
      return new SessionResolution(cookie);
    }

    if (!mayCreate) {
      return new SessionResolution(null);
    }

    const context = SessionResolver.requestContext(request);
    const uuid = await this.gateway.create(incoming.emrSessionPayload(), context.userAgent, context.clientIp);
    if (uuid === null || SessionResolver.validUuid(uuid) === null) {
      this.log.warning('session.create_failed', { path: request.path });
      return new SessionResolution(null);
    }

    const state = new JourneyState();
    state.attribution = incoming;
    state.reconciled = true;
    journey.adopt(uuid, state);

    return new SessionResolution(uuid, true);
  }

  private captureAttribution(request: Request): Attribution {
    const referrer = request.get('Referer') ?? null;
    return Attribution.capture(request.query as Record<string, unknown>, referrer);
  }

  private static requestContext(request: Request): { userAgent: string | null; clientIp: string | null } {
    return {
      userAgent: request.get('User-Agent') ?? null,
      clientIp: request.ip ?? null,
    };
  }

  /** Accepted session-identifier shape (`[4.10]`): a canonical UUID or a hex object id. */
  private static readonly UUID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{15,63}$/;

  private static validUuid(value: string): string | null {
    const trimmed = value.trim();
    return SessionResolver.UUID_PATTERN.test(trimmed) ? trimmed : null;
  }
}

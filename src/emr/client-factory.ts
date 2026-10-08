import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { AsterMDClient, FileTokenStore } from '@astermd-hq/sdk';
import { ConfigService } from '../support/config';

/**
 * Ported from storefront-lamp/core/Emr/ClientFactory.php. Builds the one shared
 * {@link AsterMDClient} every EMR-family gateway calls through.
 *
 * Credentials (`ASTERMD_CLIENT_ID` / `ASTERMD_CLIENT_SECRET`) are read directly from
 * `process.env`, never through `ConfigService` — they are secrets, never committed alongside
 * `config/app.ts`, exactly as the PHP original reads them from `$_ENV` rather than `Config`.
 *
 * The token cache is file-backed (`@astermd-hq/sdk`'s own `FileTokenStore`, the same package's
 * PHP-side equivalent storefront-lamp already uses) so it survives across process restarts and
 * CLI invocations, at the same path storefront-lamp uses: `storage/cache/emr-token.json`.
 *
 * Unlike the PHP original — where each gateway calls `ClientFactory::create()` once and memoizes
 * the result itself — this factory memoizes the single `AsterMDClient` instance here, since Nest
 * already gives every gateway the same singleton `EmrClientFactory`. This also matches the SDK's
 * own advice to construct one client and share it.
 */
@Injectable()
export class EmrClientFactory {
  private client: AsterMDClient | null = null;

  constructor(private readonly config: ConfigService) {}

  /**
   * Returns the shared EMR client, building it on first use.
   *
   * @throws {Error} if `ASTERMD_CLIENT_ID` or `ASTERMD_CLIENT_SECRET` is blank
   */
  create(): AsterMDClient {
    if (this.client) return this.client;

    const clientId = (process.env.ASTERMD_CLIENT_ID ?? '').trim();
    const clientSecret = (process.env.ASTERMD_CLIENT_SECRET ?? '').trim();

    if (clientId === '' || clientSecret === '') {
      throw new Error('ASTERMD_CLIENT_ID and ASTERMD_CLIENT_SECRET must be set in the environment to create an EMR client.');
    }

    const wireLog = this.config.app.debug.wireLog;

    this.client = new AsterMDClient({
      clientId,
      clientSecret,
      baseHost: this.config.app.emr.baseHost,
      tokenStore: new FileTokenStore(join(process.cwd(), 'storage/cache/emr-token.json')),
      // Off unless a deployment asks for it, and when asked for, asked for whole: the point of
      // this switch is reproducing a call by hand, and a redacted transcript cannot be replayed —
      // see storefront-lamp's ClientFactory.php for the same tradeoff.
      debug: wireLog,
      debugFile: wireLog ? join(process.cwd(), 'storage/logs/emr-wire.log') : undefined,
      debugRedact: false,
    });

    return this.client;
  }

  /**
   * Returns the configured EMR channel ID for this storefront.
   *
   * @throws {Error} if `app.emr.channelId` is not configured
   */
  channelId(): string {
    const channelId = this.config.app.emr.channelId;

    if (!channelId) {
      throw new Error('app.emr.channelId is not configured. Set ASTERMD_CHANNEL_ID in .env.');
    }

    return channelId;
  }
}

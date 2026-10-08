import { Injectable } from '@nestjs/common';
import { ConfigService } from '../support/config';

/**
 * Ported from storefront-lamp/core/Journey/SessionOptions.php. The session and attribution
 * settings, read from config once and passed as one value instead of several constructor
 * arguments.
 *
 * `trackingKeys` (the `_amd` payload decryption keys) is omitted for now — Phase 2's `Attribution`
 * doesn't decrypt an encrypted payload yet (see its doc comment), so there is nothing to key
 * against.
 */
@Injectable()
export class SessionOptions {
  readonly cookieName: string;
  readonly resumeParam: string;
  readonly payloadParam: string;
  readonly lifetimeDays: number;
  readonly excludePaths: string[];

  constructor(config: ConfigService) {
    this.cookieName = config.app.session.cookie;
    this.resumeParam = config.app.session.resumeParam;
    this.payloadParam = config.app.attribution.payloadParam;
    this.lifetimeDays = config.app.session.lifetimeDays;
    this.excludePaths = config.app.session.excludePaths;
  }
}

import { Injectable } from '@nestjs/common';
import { AbandonmentConfig, loadAbandonmentConfig } from '../../config/abandonment';
import { AppConfig, loadAppConfig } from '../../config/app';
import { ConsentConfig, loadConsentConfig } from '../../config/consent';
import { CrossSellsConfig, crossSellsConfig } from '../../config/cross-sells';
import { funnelSteps } from '../../config/funnel';
import { upsellsConfig, UpsellsConfig } from '../../config/upsells';
import { IntakeConfig, loadIntakeConfig } from '../../config/intake';
import { loadPaymentConfig, PaymentConfig } from '../../config/payment';
import { loadRetentionConfig, RetentionConfig } from '../../config/retention';
import { loadVerificationConfig, VerificationConfig } from '../../config/verification';

/**
 * Thin wrapper over the typed `config/*.ts` modules — the direct equivalent of `require
 * 'config/app.php'` in the PHP original, just resolved once instead of per-`require`. One
 * `config/*.ts` file per PHP `config/*.php` file; this service grows a getter for each as its
 * owning phase lands (payment, consent, ...).
 */
@Injectable()
export class ConfigService {
  readonly app: AppConfig;
  readonly funnel: typeof funnelSteps;
  readonly verification: VerificationConfig;
  readonly intake: IntakeConfig;
  readonly consent: ConsentConfig;
  readonly payment: PaymentConfig;
  readonly crossSells: CrossSellsConfig;
  readonly upsells: UpsellsConfig;
  readonly abandonment: AbandonmentConfig;
  readonly retention: RetentionConfig;

  constructor() {
    this.app = loadAppConfig(process.env);
    this.funnel = funnelSteps;
    this.verification = loadVerificationConfig(process.env);
    this.intake = loadIntakeConfig(process.env);
    this.consent = loadConsentConfig();
    this.payment = loadPaymentConfig(process.env);
    this.crossSells = crossSellsConfig;
    this.upsells = upsellsConfig;
    this.abandonment = loadAbandonmentConfig(process.env);
    this.retention = loadRetentionConfig(process.env);
  }

  /** Direct-key reads, mirroring the PHP original's `Config::get('a.b.c', $default)`. Phase 7 needs only these two paths so far. */
  get(path: 'payment.currency' | 'payment.attempt_stale_after_seconds', fallback: string | number): string | number {
    if (path === 'payment.currency') return this.payment.currency ?? fallback;
    if (path === 'payment.attempt_stale_after_seconds') return this.payment.attemptStaleAfterSeconds ?? fallback;
    return fallback;
  }
}

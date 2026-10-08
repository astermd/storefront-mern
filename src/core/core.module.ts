import { join } from 'node:path';
import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaClient } from '@prisma/client';
import { HttpsClient as CheckoutChampHttpsClient } from '@astermd-hq/checkoutchamp-client';
import { FetchClient as VrioFetchClient } from '@astermd-hq/vrio-client';
import { channelGenerated } from '../../config/channel.generated';
import { CatalogMerger } from '../catalog/catalog-merger';
import { CatalogProvider } from '../catalog/catalog-provider';
import { ConnectionFactory } from '../database/connection-factory';
import { CartRules } from '../domain/cart-rules';
import { FunnelRouter } from '../domain/funnel-router';
import { ProductCatalog } from '../domain/product-catalog';
import { CartMirror } from '../emr/cart-mirror';
import { EmrClientFactory } from '../emr/client-factory';
import { EmrCartGateway } from '../emr/emr-cart-gateway';
import { EmrSessionGateway } from '../emr/emr-session-gateway';
import { EmrVerificationGateway } from '../emr/emr-verification-gateway';
import { NullCartGateway } from '../emr/null-cart-gateway';
import { NullSessionGateway } from '../emr/null-session-gateway';
import { NullVerificationGateway } from '../emr/null-verification-gateway';
import { AnswerValidator } from '../forms/answer-validator';
import { DefinitionCache } from '../forms/definition-cache';
import { Disqualification } from '../forms/disqualification';
import { EmrIntakeGateway } from '../forms/emr-intake-gateway';
import { EmrLeadGateway } from '../forms/emr-lead-gateway';
import { EmrTeleformGateway } from '../forms/emr-teleform-gateway';
import { IntakeSession } from '../forms/intake-session';
import { LeadWriter } from '../forms/lead-writer';
import { NullIntakeGateway } from '../forms/null-intake-gateway';
import { NullLeadGateway } from '../forms/null-lead-gateway';
import { NullTeleformGateway } from '../forms/null-teleform-gateway';
import { RecordingIntakeGateway } from '../forms/recording-intake-gateway';
import { RecordMapper } from '../forms/record-mapper';
import { RuleEvaluator } from '../forms/rule-evaluator';
import { TeleformSource } from '../forms/teleform-source';
import { FlowDefinition } from '../funnel/flow-definition';
import { StepPreconditions } from '../funnel/step-preconditions';
import { CartStoreFactory } from '../journey/cart-store-factory';
import { JourneyStoreFactory } from '../journey/journey-store-factory';
import { SessionOptions } from '../journey/session-options';
import { SessionResolver } from '../journey/session-resolver';
import { CheckoutAttemptRepository } from '../repository/checkout-attempt-repository';
import { EventRepository } from '../repository/event-repository';
import { OrderRepository } from '../repository/order-repository';
import { RateLimitRepository } from '../repository/rate-limit-repository';
import { SessionRepository } from '../repository/session-repository';
import { AssetManifest } from '../support/asset-manifest';
import { ConfigService } from '../support/config';
import { DatabaseRateLimiter } from '../support/database-rate-limiter';
import { ErrorPresenter } from '../support/error-presenter';
import { OperatorLog } from '../support/operator-log';
import { RouteExistsChecker } from '../support/route-exists-checker';
import { EmrIdentityGateway } from '../verification/emr-identity-gateway';
import { NullIdentityGateway } from '../verification/null-identity-gateway';
import { VerificationStep } from '../verification/verification-step';
import { Consents } from '../checkout/consents';
import { DatabaseOrderRecorder } from '../checkout/database-order-recorder';
import { EmrCheckoutEventReporter } from '../checkout/emr-checkout-event-reporter';
import { NullCheckoutEventReporter } from '../checkout/null-checkout-event-reporter';
import { OrderBumps } from '../checkout/order-bumps';
import { PostChargeGuard } from '../checkout/post-charge-guard';
import { SettlementPolicy } from '../checkout/settlement-policy';
import { AdapterRegistry } from '../payment/adapter-registry';
import { CheckoutChampAdapter } from '../payment/checkout-champ/checkout-champ-adapter';
import { CheckoutChampApiFactory } from '../payment/checkout-champ/checkout-champ-api-factory';
import { CheckoutChampAuthorizeMode } from '../payment/checkout-champ/checkout-champ-authorize-mode';
import { CheckoutChampCredentials } from '../payment/checkout-champ/checkout-champ-credentials';
import { CheckoutChampRefusingTransport } from '../payment/checkout-champ/checkout-champ-refusing-transport';
import { CheckoutChampWireLog } from '../payment/checkout-champ/checkout-champ-wire-log';
import { VrioAdapter } from '../payment/vrio/vrio-adapter';
import { VrioApiFactory } from '../payment/vrio/vrio-api-factory';
import { VrioCredentials } from '../payment/vrio/vrio-credentials';
import { RefusingTransport as VrioRefusingTransport } from '../payment/vrio/refusing-transport';
import { VrioWireLog } from '../payment/vrio/vrio-wire-log';
import { MetaResolver } from '../seo/meta-resolver';
import { RobotsPolicy } from '../seo/robots-policy';
import { StructuredData } from '../seo/structured-data/structured-data';
import { Upsells } from '../upsell/upsells';
import { BoundaryTimer } from '../observability/boundary-timer';
import { Instrumentation } from '../observability/instrumentation';
import { AbandonmentSweep } from '../abandonment/abandonment-sweep';
import { RetentionPolicy } from '../retention/retention-policy';
import { RetentionSweep } from '../retention/retention-sweep';
import { LogSweep } from '../retention/log-sweep';
import { OperationalCounts } from '../observability/operational-counts';
import { ForwardReconciliation } from '../reconciliation/forward-reconciliation';
import { ReverseReconciliation } from '../reconciliation/reverse-reconciliation';
import {
  CART_GATEWAY,
  CHECKOUT_EVENT_REPORTER,
  DATABASE_CONNECTION,
  EMR_VERIFICATION_GATEWAY,
  IDENTITY_GATEWAY,
  INTAKE_GATEWAY,
  LEAD_GATEWAY,
  ORDER_RECORDER,
  PAYMENT_ADAPTER,
  PRODUCT_CATALOG,
  SESSION_GATEWAY,
  STEP_ROUTER,
  TELEFORM_GATEWAY,
} from './tokens';

@Injectable()
class DatabaseLifecycle implements OnModuleDestroy {
  constructor(@Inject(DATABASE_CONNECTION) private readonly prisma: PrismaClient) {}

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

/**
 * `@Global()` — every port-to-implementation binding lives here, the same "one place every
 * container binding is a closure" rule storefront-lamp's `docs/ARCHITECTURE.md` states for its
 * own container.
 *
 * Note on laziness: Nest resolves a given *injection* lazily (nothing is constructed until
 * something asks for it via the constructor graph), but a module's registered `providers` are all
 * instantiated eagerly at that module's init, unlike a PHP-DI container closure that only runs on
 * first `get()`. Concretely: don't register a `useFactory` provider here before its dependencies
 * (or its own logic) are ready to run — it will execute at boot regardless of whether any
 * controller/service actually injects the token yet.
 *
 * `SESSION_GATEWAY`/`CART_GATEWAY` switch between their real (`Emr*Gateway`, backed by
 * `@astermd-hq/sdk`) and Null implementations on `config.app.session.analytics` —
 * `EMR_VERIFICATION_GATEWAY` switches on `config.app.features.emrVerification` — matching
 * storefront-lamp's own `AppFactory` ternaries exactly. `NODE_ENV=test` forces both flags false
 * (see `config/app.ts`), so the test suite never reaches the network. `PRODUCT_CATALOG` is bound
 * to `CatalogProvider` (Phase 5) — replacing Phase 4's `EmptyProductCatalog` placeholder now that
 * there's real (example) catalog data to merge and serve.
 */
@Global()
@Module({
  providers: [
    ConfigService,
    {
      provide: OperatorLog,
      useFactory: () => new OperatorLog(join(process.cwd(), 'storage/logs/app.log')),
    },
    ErrorPresenter,
    RouteExistsChecker,
    {
      provide: AssetManifest,
      useFactory: () => new AssetManifest(join(process.cwd(), 'public/assets/build/manifest.json')),
    },
    EmrClientFactory,
    BoundaryTimer,
    Instrumentation,
    {
      provide: SESSION_GATEWAY,
      useFactory: (config: ConfigService, clients: EmrClientFactory, log: OperatorLog, instrumentation: Instrumentation) =>
        config.app.session.analytics ? instrumentation.sessionGateway(new EmrSessionGateway(clients, log)) : new NullSessionGateway(),
      inject: [ConfigService, EmrClientFactory, OperatorLog, Instrumentation],
    },
    {
      provide: CART_GATEWAY,
      useFactory: (config: ConfigService, clients: EmrClientFactory, log: OperatorLog, instrumentation: Instrumentation) =>
        config.app.session.analytics ? instrumentation.cartGateway(new EmrCartGateway(clients, log)) : new NullCartGateway(),
      inject: [ConfigService, EmrClientFactory, OperatorLog, Instrumentation],
    },
    {
      provide: EMR_VERIFICATION_GATEWAY,
      useFactory: (config: ConfigService, clients: EmrClientFactory, log: OperatorLog) =>
        config.app.features.emrVerification ? new EmrVerificationGateway(clients, log) : new NullVerificationGateway(),
      inject: [ConfigService, EmrClientFactory, OperatorLog],
    },
    {
      provide: TELEFORM_GATEWAY,
      useFactory: (config: ConfigService, clients: EmrClientFactory, log: OperatorLog, instrumentation: Instrumentation) =>
        config.app.session.analytics ? instrumentation.teleformGateway(new EmrTeleformGateway(clients, log)) : new NullTeleformGateway(),
      inject: [ConfigService, EmrClientFactory, OperatorLog, Instrumentation],
    },
    {
      provide: INTAKE_GATEWAY,
      useFactory: (
        config: ConfigService,
        clients: EmrClientFactory,
        log: OperatorLog,
        events: EventRepository,
        instrumentation: Instrumentation,
      ) => {
        const inner = config.app.session.analytics ? instrumentation.intakeGateway(new EmrIntakeGateway(clients, log)) : new NullIntakeGateway();
        return new RecordingIntakeGateway(inner, events);
      },
      inject: [ConfigService, EmrClientFactory, OperatorLog, EventRepository, Instrumentation],
    },
    {
      provide: LEAD_GATEWAY,
      useFactory: (config: ConfigService, clients: EmrClientFactory, log: OperatorLog, instrumentation: Instrumentation) =>
        config.app.session.analytics ? instrumentation.leadGateway(new EmrLeadGateway(clients, log)) : new NullLeadGateway(),
      inject: [ConfigService, EmrClientFactory, OperatorLog, Instrumentation],
    },
    {
      provide: IDENTITY_GATEWAY,
      useFactory: (config: ConfigService, clients: EmrClientFactory, log: OperatorLog) =>
        config.verification.enabled ? new EmrIdentityGateway(clients, log) : new NullIdentityGateway(),
      inject: [ConfigService, EmrClientFactory, OperatorLog],
    },
    {
      provide: DefinitionCache,
      useFactory: (config: ConfigService) => new DefinitionCache(join(process.cwd(), 'storage/cache/forms'), config.intake.cache.ttlSeconds),
      inject: [ConfigService],
    },
    RuleEvaluator,
    AnswerValidator,
    RecordMapper,
    {
      provide: Disqualification,
      useFactory: (evaluator: RuleEvaluator, config: ConfigService, log: OperatorLog) => new Disqualification(evaluator, config.intake, log),
      inject: [RuleEvaluator, ConfigService, OperatorLog],
    },
    LeadWriter,
    TeleformSource,
    IntakeSession,
    VerificationStep,
    CatalogMerger,
    CatalogProvider,
    { provide: PRODUCT_CATALOG, useExisting: CatalogProvider },
    {
      provide: CartRules,
      useFactory: (catalog: ProductCatalog) => new CartRules(catalog),
      inject: [PRODUCT_CATALOG],
    },
    ConnectionFactory,
    {
      provide: DATABASE_CONNECTION,
      useFactory: (factory: ConnectionFactory) => factory.create(),
      inject: [ConnectionFactory],
    },
    DatabaseLifecycle,
    SessionRepository,
    EventRepository,
    CartMirror,
    SessionOptions,
    SessionResolver,
    JourneyStoreFactory,
    CartStoreFactory,
    {
      provide: FlowDefinition,
      useFactory: (config: ConfigService) => new FlowDefinition(config.funnel),
      inject: [ConfigService],
    },
    {
      provide: StepPreconditions,
      useFactory: (catalog: ProductCatalog, config: ConfigService) =>
        new StepPreconditions(catalog, config.verification),
      inject: [PRODUCT_CATALOG, ConfigService],
    },
    {
      provide: STEP_ROUTER,
      useFactory: (catalog: ProductCatalog, config: ConfigService) => new FunnelRouter(catalog, config.verification),
      inject: [PRODUCT_CATALOG, ConfigService],
    },
    // Phase 7 — checkout.
    CheckoutAttemptRepository,
    RateLimitRepository,
    OrderRepository,
    DatabaseRateLimiter,
    PostChargeGuard,
    Consents,
    OrderBumps,
    Upsells,
    SettlementPolicy,
    {
      // Registers the two real providers (`vrio`, `checkout_champ`) — ported from
      // `AppFactory.php`'s own `AdapterRegistry` wiring. Registered as factories, not instances: a
      // deployment whose channel carries no payment processor must still boot, and the registry
      // answers with a configuration-error decline instead of a container that cannot be built.
      //
      // Under `config.app.env === 'test'`, each provider's transport is substituted with its own
      // `RefusingTransport` (the adapter itself is chosen from synced channel data rather than the
      // environment, so unlike every EMR port there is no Null implementation standing between a
      // test and the live provider) — wire logging, when on, wraps whichever transport that is.
      provide: AdapterRegistry,
      useFactory: (log: OperatorLog, config: ConfigService) => {
        const registry = new AdapterRegistry(log);
        const rootDir = process.cwd();

        registry.register(
          'vrio',
          () =>
            new VrioAdapter(
              VrioCredentials.fromChannelConfig(channelGenerated.payment_processor.config),
              new VrioApiFactory(
                (() => {
                  const inner = config.app.env === 'test' ? new VrioRefusingTransport() : null;
                  if (config.app.debug.wireLog !== true) return inner;
                  return new VrioWireLog(inner ?? new VrioFetchClient(30, 10), join(rootDir, 'storage/logs/vrio-wire.log'));
                })(),
              ),
              log,
              config.payment.shippingProfileId,
            ),
        );

        registry.register(
          'checkout_champ',
          () =>
            new CheckoutChampAdapter(
              CheckoutChampCredentials.fromChannelConfig(channelGenerated.payment_processor.config),
              new CheckoutChampApiFactory(
                (() => {
                  const inner = config.app.env === 'test' ? new CheckoutChampRefusingTransport() : null;
                  if (config.app.debug.wireLog !== true) return inner;
                  return new CheckoutChampWireLog(inner ?? new CheckoutChampHttpsClient(30, 10), join(rootDir, 'storage/logs/checkout-champ-wire.log'));
                })(),
              ),
              log,
              `${config.app.url.replace(/\/+$/, '')}/checkout/`,
              CheckoutChampAuthorizeMode.parse(config.payment.checkoutChamp.authorizeMode) ?? CheckoutChampAuthorizeMode.Qa,
            ),
        );

        return registry;
      },
      inject: [OperatorLog, ConfigService],
    },
    {
      // The provider is chosen from synced channel data, never named by a code path — the config
      // key is an operator override for a deployment that has to pin one. Wrapped unconditionally,
      // matching `AppFactory.php`'s own binding — payment must always be observable, whether or
      // not it currently resolves to a real provider.
      provide: PAYMENT_ADAPTER,
      useFactory: (registry: AdapterRegistry, config: ConfigService, instrumentation: Instrumentation) =>
        instrumentation.paymentAdapter(registry.for(config.payment.adapter ?? channelGenerated.payment_processor.provider_category)),
      inject: [AdapterRegistry, ConfigService, Instrumentation],
    },
    DatabaseOrderRecorder,
    { provide: ORDER_RECORDER, useExisting: DatabaseOrderRecorder },
    NullCheckoutEventReporter,
    {
      // Config-gated real-vs-Null, matching every other real EMR port in this module
      // (`SESSION_GATEWAY`/`CART_GATEWAY`/`LEAD_GATEWAY`) — real once `session.analytics` is on,
      // matching `AppFactory.php`'s own unconditional binding of `EmrCheckoutEventReporter`. Built
      // after discovering, live, that a fully successful checkout in this port still told AsterMD
      // nothing at all: no `checkoutEvents()` funnel record, and — the more serious half — no
      // `treatments().sync()` call, meaning even a real, paid order would never reach a clinician's
      // review queue. Injecting `REQUEST`/`JourneyStoreFactory` makes this provider request-scoped,
      // the same as `CheckoutService` itself.
      provide: CHECKOUT_EVENT_REPORTER,
      useFactory: (
        config: ConfigService,
        clients: EmrClientFactory,
        events: EventRepository,
        orders: OrderRepository,
        log: OperatorLog,
        journeyStoreFactory: JourneyStoreFactory,
        request: Request,
        nullReporter: NullCheckoutEventReporter,
        instrumentation: Instrumentation,
      ) =>
        instrumentation.checkoutEventReporter(
          config.app.session.analytics
            ? new EmrCheckoutEventReporter(clients, events, orders, log, journeyStoreFactory, config, request)
            : nullReporter,
        ),
      inject: [ConfigService, EmrClientFactory, EventRepository, OrderRepository, OperatorLog, JourneyStoreFactory, REQUEST, NullCheckoutEventReporter, Instrumentation],
    },
    // Phase 9 — SEO.
    MetaResolver,
    {
      provide: RobotsPolicy,
      useFactory: (config: ConfigService) => RobotsPolicy.fromConfig(config),
      inject: [ConfigService],
    },
    StructuredData,
    // Phase 10 — abandonment, retention, console commands.
    AbandonmentSweep,
    {
      provide: RetentionPolicy,
      useFactory: (config: ConfigService) => RetentionPolicy.fromConfig(config),
      inject: [ConfigService],
    },
    RetentionSweep,
    {
      provide: LogSweep,
      useFactory: () => new LogSweep(join(process.cwd(), 'storage/logs')),
    },
    OperationalCounts,
    ForwardReconciliation,
    ReverseReconciliation,
  ],
  exports: [
    ConfigService,
    OperatorLog,
    ErrorPresenter,
    RouteExistsChecker,
    AssetManifest,
    EmrClientFactory,
    BoundaryTimer,
    Instrumentation,
    SESSION_GATEWAY,
    CART_GATEWAY,
    EMR_VERIFICATION_GATEWAY,
    TELEFORM_GATEWAY,
    INTAKE_GATEWAY,
    LEAD_GATEWAY,
    IDENTITY_GATEWAY,
    DefinitionCache,
    RuleEvaluator,
    AnswerValidator,
    RecordMapper,
    Disqualification,
    LeadWriter,
    TeleformSource,
    IntakeSession,
    VerificationStep,
    PRODUCT_CATALOG,
    CatalogProvider,
    CartRules,
    DATABASE_CONNECTION,
    SessionRepository,
    EventRepository,
    CartMirror,
    SessionOptions,
    SessionResolver,
    JourneyStoreFactory,
    CartStoreFactory,
    FlowDefinition,
    StepPreconditions,
    STEP_ROUTER,
    CheckoutAttemptRepository,
    RateLimitRepository,
    OrderRepository,
    DatabaseRateLimiter,
    PostChargeGuard,
    Consents,
    OrderBumps,
    Upsells,
    SettlementPolicy,
    PAYMENT_ADAPTER,
    ORDER_RECORDER,
    CHECKOUT_EVENT_REPORTER,
    MetaResolver,
    RobotsPolicy,
    StructuredData,
    AbandonmentSweep,
    RetentionPolicy,
    RetentionSweep,
    LogSweep,
    OperationalCounts,
    ForwardReconciliation,
    ReverseReconciliation,
  ],
})
export class CoreModule {}

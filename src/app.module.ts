import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { CoreModule } from './core/core.module';
import { AttributionMiddleware } from './middleware/attribution.middleware';
import { CanonicalUrlMiddleware } from './middleware/canonical-url.middleware';
import { CsrfMiddleware } from './middleware/csrf.middleware';
import { JourneySaveBackMiddleware } from './middleware/journey-save-back.middleware';
import { RetiredSessionMiddleware } from './middleware/retired-session.middleware';
import { SeoMiddleware } from './middleware/seo.middleware';
import { SessionMiddleware } from './middleware/session.middleware';
import { StepGuardMiddleware } from './middleware/step-guard.middleware';
import { TemplateGlobalsMiddleware } from './middleware/template-globals.middleware';
import { CartModule } from './routes/cart/cart.module';
import { CatalogModule } from './routes/catalog/catalog.module';
import { CheckoutModule } from './routes/checkout/checkout.module';
import { FallbackModule } from './routes/fallback/fallback.module';
import { HealthModule } from './routes/health/health.module';
import { HomeModule } from './routes/home/home.module';
import { IntakeModule } from './routes/intake/intake.module';
import { LegalModule } from './routes/legal/legal.module';
import { NotEligibleModule } from './routes/not-eligible/not-eligible.module';
import { ReceiptModule } from './routes/receipt/receipt.module';
import { SeoModule } from './routes/seo/seo.module';
import { UpsellModule } from './routes/upsell/upsell.module';
import { VerifyModule } from './routes/verify/verify.module';

/**
 * The only place allowed to know how the pieces fit together — mirrors storefront-lamp's
 * `AppFactory::create()`. `configure()` registers the 9 pinned middleware slots, in the exact
 * documented order, as Nest middleware (never guards/interceptors) — see MERN.md's "The
 * middleware pipeline" section and `journey-save-back.middleware.ts`'s doc comment for why.
 *
 * `FallbackModule` must stay last in `imports` — see its controller's doc comment.
 */
@Module({
  imports: [
    CoreModule,
    HealthModule,
    HomeModule,
    CatalogModule,
    CartModule,
    IntakeModule,
    NotEligibleModule,
    VerifyModule,
    CheckoutModule,
    UpsellModule,
    ReceiptModule,
    SeoModule,
    LegalModule,
    FallbackModule,
  ],
  providers: [
    CanonicalUrlMiddleware,
    SeoMiddleware,
    SessionMiddleware,
    RetiredSessionMiddleware,
    AttributionMiddleware,
    CsrfMiddleware,
    JourneySaveBackMiddleware,
    StepGuardMiddleware,
    TemplateGlobalsMiddleware,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(
        // Plain Express middleware (not a Nest class), first in the chain — every pinned
        // middleware after this one reads `req.cookies`, and nothing populates it without this.
        // Its absence was invisible for the whole Null-EMR era: SESSION_GATEWAY.create() always
        // returned null under NullSessionGateway, so no request ever had a real cookie to "trust"
        // in the first place — see SessionResolver's "cookie-present -> trust it" branch. Once
        // EmrSessionGateway started minting real sessions, every request re-minted a brand new one
        // instead of recognizing its own cookie, discovered via a real curl round-trip (the
        // `amd_session` value changed on every single request despite the cookie being sent back
        // correctly).
        cookieParser(),
        CanonicalUrlMiddleware,
        SeoMiddleware,
        SessionMiddleware,
        RetiredSessionMiddleware,
        AttributionMiddleware,
        CsrfMiddleware,
        JourneySaveBackMiddleware, // wraps everything after it, including StepGuardMiddleware
        StepGuardMiddleware,
        TemplateGlobalsMiddleware,
      )
      // `forRoutes('/')`, not `'*'`/`'*splat'` — this is load-bearing, not a style choice.
      // Nest's `MiddlewareConsumer` ultimately calls Express's `app.use(path, fn)`, and Express
      // treats ANY non-root path given to `.use()` as a mount prefix: it relativizes `req.url` for
      // the duration of that middleware, stripping whatever the path matched. For a wildcard
      // pattern, the "matched prefix" is the entire request path, so every pinned middleware saw
      // `req.path === '/'` regardless of the real URL (confirmed empirically: `GET /checkout/`
      // arrived at `StepGuardMiddleware` as path `/`, while `req.originalUrl` correctly still said
      // `/checkout/` — the guard evaluated the wrong step's requirements as a result). Nest special
      // -cases a path matching `/^\/?$/` (i.e. `'/'` or `''`) to skip the path argument entirely
      // and call `app.use(fn)`, which Express does NOT relativize. `'/'` is therefore the only
      // spelling of "every route" that doesn't corrupt every downstream middleware's view of the
      // URL — this is the pinned-middleware-registration equivalent of the `NotFoundController`'s
      // `@All('*splat')` fix, which solves a *different* Express-5-specific problem (routing needs
      // a named wildcard) that doesn't apply here at all.
      .forRoutes('/');
  }
}

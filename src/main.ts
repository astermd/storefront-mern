import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
loadDotenv();

import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AssetManifest } from './support/asset-manifest';
import { ErrorPresenter } from './support/error-presenter';
import { formatMoney } from './support/format-money';
import { HttpExceptionFilter } from './support/http-exception.filter';
import { Url } from './support/url';

/**
 * Bootstrap only — the same discipline storefront-lamp's `public/index.php` and `AppFactory`
 * split between them. Nothing about how the pieces fit together belongs here; that's
 * `AppModule`'s job.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const expressInstance = app.getHttpAdapter().getInstance();

  // Serves `public/assets/**` at `/assets/**` — matching what `AssetManifest`/the `asset()`
  // template global resolve to (`/assets/build/app.<hash>.css`) and where the catalog's static
  // `image`/`gallery` paths point (`/assets/media/*`, `/assets/img/*`, `/assets/fonts/*`).
  // `public/css`/`public/js` are Tailwind/JS *source*, the build's input — not served directly,
  // the same way storefront-lamp's `theme/` sits outside its `public/` document root entirely.
  app.useStaticAssets(join(process.cwd(), 'public/assets'), { prefix: '/assets' });

  const assetManifest = app.get(AssetManifest);

  // EJS is one of Express's natively-supported view engines — no manual engine wiring needed
  // beyond naming the views directory and the engine itself. EJS has no Nunjucks-style
  // addFilter()/addGlobal(); a template helper is just a function sitting in `app.locals`, which
  // Express merges into every render's locals (see MERN.md's "Templates" section for why
  // app.locals — persists across requests — is the right lifetime for these, vs.
  // TemplateGlobalsMiddleware's per-request res.locals).
  app.set('views', join(process.cwd(), 'views'));
  app.set('view engine', 'ejs');
  // `app.locals` lives on the underlying Express instance, not on Nest's wrapper.
  expressInstance.locals.asset = (name: string) => assetManifest.resolve(name);
  expressInstance.locals.url = (path: string, query?: Record<string, string>) => Url.build(path, query);
  expressInstance.locals.money = (cents: number) => formatMoney(cents);

  // Validates every incoming request body against its controller method's DTO class
  // (class-validator decorators) before the controller ever sees it — additive to, not a
  // replacement for, the domain-layer validators (CartRules, BuyerValidator, ...) MERN.md
  // describes elsewhere. `whitelist` strips properties the DTO doesn't declare rather than
  // erroring on them; `transform` lets a controller declare `@Body() dto: SomeDto` and receive an
  // actual class instance instead of a plain object.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const errorPresenter = app.get(ErrorPresenter);

  // Catches exceptions from guards/interceptors/pipes/controllers.
  app.useGlobalFilters(new HttpExceptionFilter(errorPresenter));

  // Catches exceptions thrown inside the pinned middleware (Phase 2), registered on the raw
  // Express instance rather than through Nest — Nest's own exception-filter mechanism only sees
  // exceptions raised from its own guard -> interceptor -> pipe -> controller stage. Both
  // boundaries share the same ErrorPresenter. See MERN.md's "Error handling" section.
  expressInstance.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    errorPresenter.render(err, req, res);
  });

  const port = process.env.PORT ? Number(process.env.PORT) : 8080;
  await app.listen(port);
  console.log(`NestJS server listening on port ${port} (PID ${process.pid})`);
}

void bootstrap();

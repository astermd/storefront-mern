import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { TestingModule } from '@nestjs/testing';
import { AssetManifest } from '../../src/support/asset-manifest';
import { ErrorPresenter } from '../../src/support/error-presenter';
import { formatMoney } from '../../src/support/format-money';
import { HttpExceptionFilter } from '../../src/support/http-exception.filter';
import { Url } from '../../src/support/url';

/**
 * Mirrors `src/main.ts`'s bootstrap wiring (EJS view engine + helpers, the global `ValidationPipe`,
 * both error boundaries) minus `app.listen()` — the direct test-time equivalent of
 * `AppFactory::create($root, $overrides)` from the PHP original, applied on top of whatever
 * `Test.createTestingModule({...}).compile()` produced. Every e2e test that needs a fully wired
 * app (not just an isolated provider) should go through this rather than reimplementing the
 * wiring inline.
 */
export async function createTestApp(moduleRef: TestingModule): Promise<NestExpressApplication> {
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  const expressInstance = app.getHttpAdapter().getInstance();

  const assetManifest = app.get(AssetManifest);
  app.set('views', join(process.cwd(), 'views'));
  app.set('view engine', 'ejs');
  expressInstance.locals.asset = (name: string) => assetManifest.resolve(name);
  expressInstance.locals.url = (path: string, query?: Record<string, string>) => Url.build(path, query);
  expressInstance.locals.money = (cents: number) => formatMoney(cents);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const errorPresenter = app.get(ErrorPresenter);
  app.useGlobalFilters(new HttpExceptionFilter(errorPresenter));
  expressInstance.use((err: unknown, req: any, res: any, _next: any) => {
    errorPresenter.render(err, req, res);
  });

  await app.init();
  return app;
}

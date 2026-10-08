import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Ported from storefront-lamp's `PageController` as wired for `/terms/`, `/privacy/`,
 * `/telehealth-consent/` in `config/routes.php` — the PHP original uses one generic
 * "render `$args['template']`" controller for every static page; this port gives each route its
 * own thin method instead, since Nest has no equivalent of Slim's route-argument style and three
 * one-line methods are clearer than a template-name lookup table.
 *
 * None of the three pass an explicit `noindex` — deliberately, so `partials/head.ejs` falls
 * through to the real per-path `RobotsPolicy` directive (`seo.robots`) instead. None of them are in
 * `config/app.ts`'s `seo.robotsRules`, so in production they render indexable; under the sitewide
 * `discourageIndexing` master switch (every non-production environment) they correctly agree with
 * the `X-Robots-Tag` header `SeoMiddleware` already sets on every response.
 */
@Controller()
export class LegalController {
  @Get('terms')
  terms(@Res() res: Response): void {
    res.render('pages/legal/terms');
  }

  @Get('privacy')
  privacy(@Res() res: Response): void {
    res.render('pages/legal/privacy');
  }

  @Get('telehealth-consent')
  telehealthConsent(@Res() res: Response): void {
    res.render('pages/legal/telehealth-consent');
  }
}

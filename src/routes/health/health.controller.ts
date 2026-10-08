import { Controller, Get, HttpCode } from '@nestjs/common';

/**
 * Ported from storefront-lamp/core/Http/Controller/HealthController.php, reduced to its shape for
 * Phase 1 — a cheap, dependency-free route proving the request lifecycle end to end before the
 * persistence/config/storage checks it will grow (config, DB, storage, form cache -> 503 if any
 * false) exist to report on. Those land alongside their owning phases (3, 6).
 */
@Controller('health')
export class HealthController {
  @Get()
  @HttpCode(200)
  check() {
    return {
      checks: {},
      info: {},
    };
  }
}

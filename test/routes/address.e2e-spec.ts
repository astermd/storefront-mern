import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ADDRESS_AUTOFILL } from '../../src/core/tokens';
import { AddressAutofill } from '../../src/emr/address-autofill';
import { DatabaseRateLimiter } from '../../src/support/database-rate-limiter';
import { createTestApp } from '../support/test-app';

/**
 * Ported from storefront-lamp/tests/Http/AddressControllerTest.php: the storefront's own
 * `/checkout/address/…` endpoints, the checkout address field's suggestions when there is no Google
 * Maps key.
 */
describe('Checkout address suggestions', () => {
  const asked: string[] = [];
  let allowed = true;
  let app: NestExpressApplication;

  const autofill: AddressAutofill = {
    async suggest(search) {
      asked.push(search);
      return [{ address: '350 5th Ave, New York, NY, USA', main_text: '350 5th Ave' }];
    },
    async resolve() {
      return { address_line: '350 5th Avenue', city: 'New York', territory: 'NY', postal_code: '10118' };
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ADDRESS_AUTOFILL)
      .useValue(autofill)
      .overrideProvider(DatabaseRateLimiter)
      .useValue({ allow: async () => allowed })
      .compile();

    app = await createTestApp(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    asked.length = 0;
    allowed = true;
  });

  it('suggestions are JSON the browser never caches', async () => {
    const res = await request(app.getHttpServer()).get('/checkout/address/suggest/?q=350+5th');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.suggestions[0].main_text).toBe('350 5th Ave');
    expect(asked).toEqual(['350 5th']);
  });

  it('a resolved address is the four checkout fields', async () => {
    const res = await request(app.getHttpServer()).get('/checkout/address/resolve/?address=' + encodeURIComponent('350 5th Ave, New York, NY, USA'));

    expect(res.body.address).toEqual({ address_line: '350 5th Avenue', city: 'New York', territory: 'NY', postal_code: '10118' });
  });

  it('a too-short search spends no call', async () => {
    const res = await request(app.getHttpServer()).get('/checkout/address/suggest/?q=35');

    expect(res.body.suggestions).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('a spent bucket is refused without asking', async () => {
    allowed = false;

    const res = await request(app.getHttpServer()).get('/checkout/address/suggest/?q=350+5th');

    expect(res.status).toBe(429);
    expect(res.body.suggestions).toEqual([]);
    expect(asked).toEqual([]);
  });
});

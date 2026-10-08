import { All, Controller, ForbiddenException } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestApp } from './support/test-app';

const LOG_FILE = join(process.cwd(), 'storage/logs/app.log');

@Controller('__test-only')
class TestOnlyController {
  @All('boom')
  boom(): never {
    throw new Error('deliberate test failure');
  }

  @All('forbidden')
  forbidden(): never {
    throw new ForbiddenException('Not allowed.');
  }
}

/**
 * Proves Phase 1's "done" bar from the plan: the app boots, `GET /health/` returns 200, an
 * unmatched route returns the themed 404, a thrown 4xx HttpException is themed but NOT logged,
 * and any other throw returns the themed 500 with a request id that IS logged — both boundaries
 * sharing one ErrorPresenter.
 */
describe('App bootstrap (Phase 1)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    rmSync(LOG_FILE, { force: true });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestOnlyController],
    }).compile();

    app = await createTestApp(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 JSON on GET /health/', async () => {
    const res = await request(app.getHttpServer()).get('/health/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ checks: {}, info: {} });
  });

  it('renders the themed 404 page for an unmatched route, with X-Robots-Tag', async () => {
    const res = await request(app.getHttpServer()).get('/this-does-not-exist/');
    expect(res.status).toBe(404);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.text).toContain('Page not found');
  });

  it('renders the themed HTTP-error page for a thrown 4xx, and does not log it', async () => {
    const res = await request(app.getHttpServer()).get('/__test-only/forbidden/');
    expect(res.status).toBe(403);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.text).toContain('Not allowed.');

    expect(readLogSafely()).not.toContain('Not allowed.');
  });

  it('renders the themed 500 page with a request id and logs the failure', async () => {
    const res = await request(app.getHttpServer()).get('/__test-only/boom/');
    expect(res.status).toBe(500);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.text).toMatch(/Reference: [0-9a-f]{16}/);

    const logContents = readLogSafely();
    expect(logContents).toContain('http.unhandled_exception');
    expect(logContents).toContain('deliberate test failure');
  });
});

function readLogSafely(): string {
  try {
    return readFileSync(LOG_FILE, 'utf8');
  } catch {
    return '';
  }
}

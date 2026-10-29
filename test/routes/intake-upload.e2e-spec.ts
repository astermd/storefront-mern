import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { CatalogProvider } from '../../src/catalog/catalog-provider';
import { DATABASE_CONNECTION, INTAKE_GATEWAY, INTAKE_UPLOADS, SESSION_GATEWAY, TELEFORM_GATEWAY } from '../../src/core/tokens';
import { TeleformMetadata } from '../../src/forms/teleform-metadata';
import { FakeCatalogProvider } from '../support/fake-catalog-provider';
import { FakeIntakeUploads } from '../support/fake-intake-uploads';
import { FakeSessionGateway } from '../support/fake-session-gateway';
import { FakeTeleformGateway } from '../support/fake-teleform-gateway';
import { createTestApp } from '../support/test-app';

/**
 * Ported from storefront-lamp/tests/Http/IntakeUploadTest.php: the `/intake/upload/…` relay to the
 * EMR, and what a save and a submit then store and send.
 *
 * The EMR is `FakeIntakeUploads`, which files every upload under the session it was sent for,
 * exactly as the EMR does — so the case that posts someone else's path is posting a path the fake
 * would never have produced for this visitor.
 */
const SESSION = '4f1b6f2a-8c3d-4e6a-9b7f-2d5e8a1c6f30';
const OTHER_SESSION = '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a';
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const OPTIONAL = { slug: 'files-optional', teleform: 'files-optional-form' };
const REQUIRED = { slug: 'files-required', teleform: 'files-required-form' };

const reference = (session: string, name: string) => ({
  path: `acct1/org1/intake_submissions/${session}/${name}`,
  name,
  mime_type: 'application/pdf',
});

function definition(required: boolean): Record<string, unknown> {
  return {
    pages: [
      {
        pageId: 'p1',
        order: 1,
        fields: [
          { fieldId: 'first_name', name: 'first_name', type: 'text', label: 'First name', order: 1, required: true },
          {
            fieldId: 'labs',
            name: 'labs',
            type: 'file-upload',
            label: 'Recent lab results',
            order: 2,
            required,
            properties: { allowMultipleFiles: true, maxFiles: 2, fileTypes: 'pdf,png,mp4', maxFileSizeMb: 20 },
          },
          { fieldId: 'consent_signature', name: 'consent_signature', type: 'signature', label: 'Signature', order: 3, required },
          { fieldId: 'submit_btn', name: 'submit_btn', type: 'button', label: 'Submit', order: 4, properties: { buttonAction: 'submit' } },
        ],
      },
    ],
  };
}

describe('Intake file uploads', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let dbDir: string;
  const uploads = new FakeIntakeUploads();
  const recorded = jest.fn().mockResolvedValue(true);

  beforeAll(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'mern-test-intake-upload-db-'));
    const url = `file:${join(dbDir, 'test.sqlite3')}`;
    execFileSync('npx', ['prisma', 'db', 'push', '--url', url, '--accept-data-loss'], { cwd: process.cwd(), stdio: 'ignore' });
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

    const product = (spec: { slug: string; teleform: string }) => ({
      slug: spec.slug,
      name: spec.slug,
      kind: 'otc' as const,
      price_cents: 1000,
      teleform_id: spec.teleform,
      variants: [{ id: 'default', name: 'Standard', price_cents: 1000, provider: { offer_id: 'offer-1', product_id: 'product-1' } }],
    });

    const teleforms = new FakeTeleformGateway()
      .register(new TeleformMetadata(OPTIONAL.teleform, `${OPTIONAL.teleform}-v1`, 'intake', 'single-column', {}), definition(false))
      .register(new TeleformMetadata(REQUIRED.teleform, `${REQUIRED.teleform}-v1`, 'intake', 'single-column', {}), definition(true));

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(prisma)
      .overrideProvider(CatalogProvider)
      .useValue(new FakeCatalogProvider([product(OPTIONAL), product(REQUIRED)]))
      .overrideProvider(TELEFORM_GATEWAY)
      .useValue(teleforms)
      .overrideProvider(SESSION_GATEWAY)
      .useValue(new FakeSessionGateway(SESSION))
      .overrideProvider(INTAKE_UPLOADS)
      .useValue(uploads)
      .overrideProvider(INTAKE_GATEWAY)
      .useValue({ record: recorded })
      .compile();

    app = await createTestApp(moduleRef);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    rmSync(dbDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    uploads.calls = [];
    uploads.refuse = false;
    recorded.mockClear();
  });

  /** A visitor with the product in the cart and the form drawn once, which mints the session and the CSRF token. */
  async function started(spec = OPTIONAL): Promise<{ agent: ReturnType<typeof request.agent>; csrf: string; page: string }> {
    const agent = request.agent(app.getHttpServer());
    const productPage = await agent.get(`/products/${spec.slug}/`);
    const csrf = /name="_csrf" value="([^"]+)"/.exec(productPage.text)?.[1] ?? '';
    const added = await agent.post('/cart/add').type('form').redirects(0).send({ _csrf: csrf, slug: spec.slug, quantity: 1 });
    expect(added.status).toBe(303);
    const form = await agent.get('/intake/medical/');
    expect(form.status).toBe(200);
    return { agent, csrf, page: form.text };
  }

  const post = (agent: ReturnType<typeof request.agent>, csrf: string, path: string) => agent.post(path).set('X-CSRF-Token', csrf);

  it('the form draws a file question with the limits it will be held to', async () => {
    const { page } = await started();

    expect(page).toContain('data-intake-upload');
    expect(page).toContain('accept=".pdf,.png,.mp4"');
    expect(page).toContain('data-max-files="2"');
    expect(page).toContain('up to 20 MB each');
    expect(page).toContain('data-intake-signature-pad');
    expect(page).toContain('data-upload-url="/intake/upload/"');
    expect(page).not.toContain('data-intake-blocked');
  });

  it('a picked file is relayed whole and answered with where the EMR stored it', async () => {
    const { agent, csrf } = await started();

    const res = await post(agent, csrf, '/intake/upload').field('step', 'intake').field('field', 'labs').attach('file', Buffer.alloc(2048, 1), 'labs.pdf');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.file.path).toBe(`acct1/org1/intake_submissions/${SESSION}/labs-3f9a1c62-2b41-4f0e-91a7-6c1d0e5b8a44.pdf`);
    expect(uploads.calls).toEqual([{ call: 'upload', session: SESSION, name: 'labs.pdf', mime_type: 'application/pdf', bytes: 2048 }]);
  });

  it('a file the question does not take never reaches the EMR', async () => {
    const { agent, csrf } = await started();

    const wrongKind = await post(agent, csrf, '/intake/upload').field('step', 'intake').field('field', 'labs').attach('file', Buffer.from('x'), 'setup.exe');
    const wrongQuestion = await post(agent, csrf, '/intake/upload').field('step', 'intake').field('field', 'first_name').attach('file', Buffer.from('x'), 'labs.pdf');
    const noQuestion = await post(agent, csrf, '/intake/upload').field('step', 'intake').attach('file', Buffer.from('x'), 'labs.pdf');

    expect(wrongKind.status).toBe(422);
    expect(wrongKind.body.error).toBe('setup.exe is not a file type this question accepts.');
    expect(wrongQuestion.status).toBe(422);
    expect(noQuestion.status).toBe(422);
    expect(uploads.calls).toEqual([]);
  });

  it('a video arriving whole is turned away, to be sent in parts', async () => {
    const { agent, csrf } = await started();

    const res = await post(agent, csrf, '/intake/upload').field('step', 'intake').field('field', 'labs').attach('file', Buffer.from('x'), 'clip.mp4');

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('clip.mp4 has to be sent in parts.');
    expect(uploads.calls).toEqual([]);
  });

  it('a file the EMR refuses is reported as one to replace', async () => {
    const { agent, csrf } = await started();
    uploads.refuse = true;

    const res = await post(agent, csrf, '/intake/upload').field('step', 'intake').field('field', 'labs').attach('file', Buffer.from('x'), 'labs.pdf');

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('labs.pdf could not be accepted. Please choose a different file.');
  });

  it('an upload without a session token is refused by the CSRF check', async () => {
    const { agent } = await started();

    const res = await agent.post('/intake/upload').field('step', 'intake').field('field', 'labs').attach('file', Buffer.from('x'), 'labs.pdf');

    expect(res.status).toBe(419);
    expect(uploads.calls).toEqual([]);
  });

  it('a video is started, sent in parts and finished', async () => {
    const { agent, csrf } = await started();

    const start = await post(agent, csrf, '/intake/upload/start').field('step', 'intake').field('field', 'labs').field('file_name', 'clip.mp4').field('file_size', String(12 * 1024 * 1024));
    expect(start.status).toBe(200);
    const uploadId: string = start.body.upload_id;
    expect(start.body.part_bytes).toBeGreaterThan(5 * 1024 * 1024);

    const part1 = await post(agent, csrf, '/intake/upload/part').field('upload_id', uploadId).field('part_number', '1').attach('file', Buffer.alloc(100), 'clip.mp4');
    const part2 = await post(agent, csrf, '/intake/upload/part').field('upload_id', uploadId).field('part_number', '2').attach('file', Buffer.alloc(50), 'clip.mp4');
    expect(part1.body).toEqual({ part_number: 1, etag: '"etag-1"' });
    expect(part2.body).toEqual({ part_number: 2, etag: '"etag-2"' });

    const finish = await post(agent, csrf, '/intake/upload/finish')
      .field('upload_id', uploadId)
      .field('parts', JSON.stringify([part1.body, part2.body]));
    expect(finish.status).toBe(200);
    expect(finish.body.file.mime_type).toBe('video/mp4');
    expect(uploads.callNames()).toEqual(['start', 'part', 'part', 'finish']);

    // The id is spent once finished.
    const again = await post(agent, csrf, '/intake/upload/finish').field('upload_id', uploadId).field('parts', JSON.stringify([part1.body]));
    expect(again.status).toBe(400);
  });

  it('an upload this visitor did not start cannot be written, finished or aborted', async () => {
    const { agent, csrf } = await started();
    const foreignId = 'a1b2c3d4-0000-4000-8000-000000000099';

    const part = await post(agent, csrf, '/intake/upload/part').field('upload_id', foreignId).field('part_number', '1').attach('file', Buffer.alloc(10), 'clip.mp4');
    const finish = await post(agent, csrf, '/intake/upload/finish').field('upload_id', foreignId).field('parts', JSON.stringify([{ part_number: 1, etag: '"e"' }]));
    const abort = await post(agent, csrf, '/intake/upload/abort').field('upload_id', foreignId);

    expect(part.status).toBe(400);
    expect(finish.status).toBe(400);
    expect(abort.status).toBe(200);
    expect(abort.body).toEqual({ aborted: true });
    expect(uploads.calls).toEqual([]);
  });

  it('a started upload that is abandoned is aborted at the EMR', async () => {
    const { agent, csrf } = await started();
    const start = await post(agent, csrf, '/intake/upload/start').field('step', 'intake').field('field', 'labs').field('file_name', 'clip.mp4').field('file_size', '6000000');

    const abort = await post(agent, csrf, '/intake/upload/abort').field('upload_id', start.body.upload_id);

    expect(abort.body).toEqual({ aborted: true });
    expect(uploads.callNames()).toEqual(['start', 'abort']);
  });

  it("a save keeps the visitor's own files and drops a path filed under another session", async () => {
    const { agent, csrf } = await started();
    const own = reference(SESSION, 'labs-3f9a1c62-2b41-4f0e-91a7-6c1d0e5b8a44.pdf');
    const foreign = reference(OTHER_SESSION, 'someone-else-3f9a1c62-2b41-4f0e-91a7-6c1d0e5b8a44.pdf');

    await agent.post('/intake/save').type('form').redirects(0).send({ _csrf: csrf, step: 'intake', page: '0', 'labs[]': ['', JSON.stringify(own), JSON.stringify(foreign)] });

    const page = (await agent.get('/intake/medical/')).text;
    expect(page.match(/data-intake-file-ref/g)).toHaveLength(1);
    expect(page).toContain('labs');
    expect(page).not.toContain('someone-else');
  });

  it('removing the last file clears the answer', async () => {
    const { agent, csrf } = await started();
    const own = reference(SESSION, 'labs-3f9a1c62-2b41-4f0e-91a7-6c1d0e5b8a44.pdf');

    await agent.post('/intake/save').type('form').redirects(0).send({ _csrf: csrf, step: 'intake', page: '0', 'labs[]': ['', JSON.stringify(own)] });
    expect((await agent.get('/intake/medical/')).text).toContain('data-intake-file-ref');

    await agent.post('/intake/save').type('form').redirects(0).send({ _csrf: csrf, step: 'intake', page: '0', 'labs[]': [''] });
    expect((await agent.get('/intake/medical/')).text).not.toContain('data-intake-file-ref');
  });

  it('a submission sends the files and the signature under the file type', async () => {
    const { agent, csrf } = await started();
    const own = reference(SESSION, 'labs-3f9a1c62-2b41-4f0e-91a7-6c1d0e5b8a44.pdf');

    const res = await agent
      .post('/intake/submit')
      .type('form')
      .redirects(0)
      .send({ _csrf: csrf, step: 'intake', first_name: 'Ada', 'labs[]': ['', JSON.stringify(own)], consent_signature: SIGNATURE });
    expect(res.status).toBe(303);

    const sent = Object.fromEntries(
      (recorded.mock.calls[recorded.mock.calls.length - 1][3] as Array<{ name: string; type: string; value: unknown }>).map((entry) => [entry.name, entry]),
    );
    expect(sent.labs.type).toBe('file');
    expect(sent.labs.value).toEqual([{ value: own }]);
    expect(sent.consent_signature.type).toBe('file');
    expect(sent.consent_signature.value).toEqual([{ value: SIGNATURE }]);
    expect(sent.first_name.type).toBe('text');
  });

  it('a required file or signature left empty refuses the submission', async () => {
    const { agent, csrf } = await started(REQUIRED);

    const res = await agent.post('/intake/submit').type('form').redirects(0).send({ _csrf: csrf, step: 'intake', first_name: 'Ada', 'labs[]': [''], consent_signature: '' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Recent lab results is required.');
    expect(res.text).toContain('Signature is required.');
    expect(recorded.mock.calls.map((call) => String(call[1]))).not.toContain('intake_completed');
  });
});

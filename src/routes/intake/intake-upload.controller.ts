import { Body, Controller, Inject, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { PRODUCT_CATALOG } from '../../core/tokens';
import { INTAKE_UPLOADS } from '../../core/tokens';
import { Cart } from '../../domain/cart';
import { ProductCatalog } from '../../domain/product-catalog';
import { FileRules } from '../../forms/file-rules';
import { FormUnavailable } from '../../forms/form-unavailable';
import { IntakeSession } from '../../forms/intake-session';
import { IntakeUploads } from '../../forms/intake-uploads';
import { UploadOutcome } from '../../forms/upload-outcome';
import { FunnelRules } from '../../funnel/funnel-rules';
import { CartStoreFactory } from '../../journey/cart-store-factory';
import { JourneyStoreFactory } from '../../journey/journey-store-factory';
import { DatabaseRateLimiter } from '../../support/database-rate-limiter';
import { OperatorLog } from '../../support/operator-log';
import { RequestContext } from '../../support/request-context';

const BUCKET = 'intake.upload';

/** The session key holding the uploads this visitor has started and still has open. */
const STARTED = '_intake_uploads';

/** How many started uploads one visitor may hold open at once. */
const MAX_STARTED = 10;

const MAX_PARTS = 10000;

const RETRY = 'The upload did not go through. Please try again.';

const EXPIRED = 'Your session has expired. Please reload the page and attach the file again.';

interface StartedUpload {
  name: string;
  mime_type: string;
  bytes: number;
}

const multipart = { storage: memoryStorage(), limits: { fileSize: FileRules.SINGLE_REQUEST_MAX_BYTES } };

/**
 * Ported from storefront-lamp/core/Http/Controller/IntakeUploadController.php. `/intake/upload/…` —
 * a file-upload question's file, relayed to the EMR as soon as it is picked. It replaces this
 * port's earlier single `POST /intake/upload` on `IntakeController`, which returned a bare
 * reference string with no check of which question, which session's file, or how large.
 *
 * The browser cannot send it to the EMR itself: the call needs this deployment's credential, which
 * never reaches a page. So each request here is one request there, and answers what the EMR
 * answered — a `{path, name, mime_type}` for the page to post with the form, an upload id, or a
 * part's ETag. Nothing is kept on this server beyond the request (multer holds the body in memory
 * where PHP held a temp file).
 *
 * Five routes, the EMR's two flows (`FileRules.needsParts()`):
 *
 * - `upload` takes a whole file;
 * - `upload/start`, `upload/part` and `upload/finish` take a video, or anything over one request,
 *   in numbered parts;
 * - `upload/abort` gives up a started upload, so the EMR drops its parts.
 *
 * **Each request names the question it is for**, and is held to that question's rules
 * (`FileRules`) on the form this journey is collecting. The page checks the same rules first; a
 * request refused here went round it.
 *
 * **An upload id is honoured only from the HTTP session that started it.** The EMR keeps no owner
 * for one, so without this a request could send parts into, finish or abort another visitor's
 * upload by guessing its id.
 *
 * POSTs, so the CSRF check applies (the page sends the token as a header, as `intake.js`'s other
 * posts do); they are also rate-limited per client address, because each one spends an EMR call and
 * carries up to ten megabytes.
 */
@Controller('intake/upload')
export class IntakeUploadController {
  private readonly rules: FunnelRules;

  constructor(
    private readonly intake: IntakeSession,
    @Inject(INTAKE_UPLOADS) private readonly uploads: IntakeUploads,
    private readonly cartStoreFactory: CartStoreFactory,
    private readonly journeyStoreFactory: JourneyStoreFactory,
    @Inject(PRODUCT_CATALOG) catalog: ProductCatalog,
    private readonly limiter: DatabaseRateLimiter,
    private readonly log: OperatorLog,
  ) {
    this.rules = new FunnelRules(catalog);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', multipart))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!file) {
      IntakeUploadController.json(res, 400, { error: RETRY });
      return;
    }

    const asked = await this.question(req, body);
    if ('refusal' in asked) {
      IntakeUploadController.json(res, asked.refusal.status, { error: asked.refusal.error });
      return;
    }

    const { rules, session } = asked;
    const name = file.originalname;
    const bytes = file.size;
    const mimeType = rules.mimeTypeFor(name) ?? '';

    let problem = rules.refusal(name, bytes);
    if (problem === null && FileRules.needsParts(mimeType, bytes)) {
      // The page sends a video or a large file in parts; one arriving whole here came from
      // something else.
      problem = `${name} has to be sent in parts.`;
    }

    if (problem !== null) {
      IntakeUploadController.json(res, 422, { error: problem });
      return;
    }

    if (!(await this.allowed(req))) {
      IntakeUploadController.json(res, 429, { error: RETRY });
      return;
    }

    this.answer(res, await this.uploads.upload(session, file.buffer, name, mimeType), name);
  }

  @Post('start')
  @UseInterceptors(AnyFilesInterceptor())
  async start(@Body() body: Record<string, unknown>, @Req() req: Request, @Res() res: Response): Promise<void> {
    const name = typeof body.file_name === 'string' ? body.file_name.trim() : '';
    const bytes = IntakeUploadController.numeric(body.file_size) ? Math.trunc(Number(body.file_size)) : 0;

    const asked = await this.question(req, body);
    if ('refusal' in asked) {
      IntakeUploadController.json(res, asked.refusal.status, { error: asked.refusal.error });
      return;
    }

    const { rules, session } = asked;

    const problem = rules.refusal(name, bytes);
    if (problem !== null) {
      IntakeUploadController.json(res, 422, { error: problem });
      return;
    }

    const started = IntakeUploadController.started(req);
    if (Object.keys(started).length >= MAX_STARTED) {
      IntakeUploadController.json(res, 429, { error: RETRY });
      return;
    }

    if (!(await this.allowed(req))) {
      IntakeUploadController.json(res, 429, { error: RETRY });
      return;
    }

    const mimeType = rules.mimeTypeFor(name) ?? '';
    const outcome = await this.uploads.start(session, name, mimeType, bytes);

    if (!outcome.ok || outcome.uploadId === null) {
      this.answer(res, outcome, name);
      return;
    }

    started[outcome.uploadId] = { name, mime_type: mimeType, bytes };
    IntakeUploadController.store(req, started);

    IntakeUploadController.json(res, 200, { upload_id: outcome.uploadId, part_bytes: FileRules.requestBytes() });
  }

  @Post('part')
  @UseInterceptors(FileInterceptor('file', multipart))
  async part(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const uploadId = IntakeUploadController.text(body.upload_id);
    const partNumber = IntakeUploadController.numeric(body.part_number) ? Math.trunc(Number(body.part_number)) : 0;
    const upload = uploadId === null ? null : (IntakeUploadController.started(req)[uploadId] ?? null);

    if (upload === null || uploadId === null || !file || partNumber < 1 || partNumber > MAX_PARTS || file.size > FileRules.SINGLE_REQUEST_MAX_BYTES) {
      IntakeUploadController.json(res, 400, { error: RETRY });
      return;
    }

    if (!(await this.allowed(req))) {
      IntakeUploadController.json(res, 429, { error: RETRY });
      return;
    }

    const outcome = await this.uploads.part(uploadId, partNumber, file.buffer, upload.name, upload.mime_type);

    if (outcome.ok && outcome.part !== null) {
      IntakeUploadController.json(res, 200, outcome.part);
      return;
    }

    this.answer(res, outcome, upload.name);
  }

  @Post('finish')
  @UseInterceptors(AnyFilesInterceptor())
  async finish(@Body() body: Record<string, unknown>, @Req() req: Request, @Res() res: Response): Promise<void> {
    const uploadId = IntakeUploadController.text(body.upload_id);
    const upload = uploadId === null ? null : (IntakeUploadController.started(req)[uploadId] ?? null);
    const parts = IntakeUploadController.parts(body.parts);

    if (upload === null || uploadId === null || parts === null) {
      IntakeUploadController.json(res, 400, { error: RETRY });
      return;
    }

    if (!(await this.allowed(req))) {
      IntakeUploadController.json(res, 429, { error: RETRY });
      return;
    }

    const outcome = await this.uploads.finish(uploadId, parts);

    // Finished, or refused for good: either way the id is spent. A failure that might succeed on a
    // retry keeps it, so the page can retry the finish rather than send every part again.
    if (outcome.ok || outcome.refused) {
      IntakeUploadController.forget(req, uploadId);
    }

    this.answer(res, outcome, upload.name);
  }

  @Post('abort')
  @UseInterceptors(AnyFilesInterceptor())
  async abort(@Body() body: Record<string, unknown>, @Req() req: Request, @Res() res: Response): Promise<void> {
    const uploadId = IntakeUploadController.text(body.upload_id);

    if (uploadId !== null && uploadId in IntakeUploadController.started(req)) {
      await this.uploads.abort(uploadId);
      IntakeUploadController.forget(req, uploadId);
    }

    // The same answer either way: an id this visitor does not hold has nothing of theirs to abort,
    // and saying so would confirm it exists.
    IntakeUploadController.json(res, 200, { aborted: true });
  }

  /**
   * The rules of the question a request names, and the session its file is filed under — or the
   * refusal to send back.
   */
  private async question(
    req: Request,
    body: Record<string, unknown>,
  ): Promise<{ rules: FileRules; session: string } | { refusal: { status: number; error: string } }> {
    const journeys = this.journeyStoreFactory.get();
    const session = journeys.sessionUuid();
    if (session === null || session === '' || journeys.currentState() === null) {
      return { refusal: { status: 409, error: EXPIRED } };
    }

    const step = body.step === IntakeSession.STEP_PREQUALIFICATION ? IntakeSession.STEP_PREQUALIFICATION : IntakeSession.STEP_INTAKE;
    const teleformId = this.teleformId(step);
    const field = IntakeUploadController.text(body.field);

    let rules: FileRules | null = null;
    if (teleformId !== null && field !== null) {
      try {
        rules = await this.intake.fileRulesFor(teleformId, field);
      } catch (e) {
        if (!(e instanceof FormUnavailable)) throw e;
        rules = null;
      }
    }

    if (rules === null) {
      this.log.info('intake.upload_no_question', { step });
      return { refusal: { status: 422, error: EXPIRED } };
    }

    return { rules, session };
  }

  /** The same question `IntakeController` asks, so the form a file is checked against is the form on screen. */
  private teleformId(step: string): string | null {
    let cart: Cart;
    try {
      cart = this.cartStoreFactory.get().currentCart();
    } catch {
      cart = new Cart();
    }

    const state = this.journeyStoreFactory.get().currentState();

    return step === IntakeSession.STEP_PREQUALIFICATION
      ? this.rules.prequalificationFormToCollect(cart, state)
      : this.rules.intakeFormToCollect(cart, state);
  }

  private answer(res: Response, outcome: UploadOutcome, name: string): void {
    if (outcome.ok && outcome.file !== null) {
      IntakeUploadController.json(res, 200, { file: outcome.file.toArray() });
      return;
    }

    if (outcome.refused) {
      IntakeUploadController.json(res, 422, { error: `${name} could not be accepted. Please choose a different file.` });
      return;
    }

    IntakeUploadController.json(res, 502, { error: RETRY });
  }

  private allowed(req: Request): Promise<boolean> {
    return this.limiter.allow(BUCKET, RequestContext.fromRequest(req).clientIp ?? 'unknown');
  }

  private static started(req: Request): Record<string, StartedUpload> {
    const started = (req.session as unknown as Record<string, unknown>)[STARTED];
    return started !== null && typeof started === 'object' && !Array.isArray(started) ? { ...(started as Record<string, StartedUpload>) } : {};
  }

  private static store(req: Request, started: Record<string, StartedUpload>): void {
    (req.session as unknown as Record<string, unknown>)[STARTED] = started;
  }

  private static forget(req: Request, uploadId: string): void {
    const started = IntakeUploadController.started(req);
    delete started[uploadId];
    IntakeUploadController.store(req, started);
  }

  /**
   * The part list the page posts to finish an upload, as JSON, or null when it is not one.
   */
  private static parts(posted: unknown): Array<{ part_number: number; etag: string }> | null {
    let decoded: unknown = null;
    if (typeof posted === 'string' && posted.length <= 200_000) {
      try {
        decoded = JSON.parse(posted);
      } catch {
        decoded = null;
      }
    }

    if (!Array.isArray(decoded) || decoded.length === 0 || decoded.length > MAX_PARTS) return null;

    const parts: Array<{ part_number: number; etag: string }> = [];
    for (const part of decoded) {
      const record = part !== null && typeof part === 'object' ? (part as Record<string, unknown>) : {};
      const number = record.part_number;
      const etag = record.etag;
      if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number > MAX_PARTS || typeof etag !== 'string' || etag === '') {
        return null;
      }

      parts.push({ part_number: number, etag });
    }

    return parts;
  }

  private static text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' && value.length <= 200 ? value.trim() : null;
  }

  private static numeric(value: unknown): boolean {
    return (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
  }

  private static json(res: Response, status: number, data: Record<string, unknown>): void {
    res.status(status).set('Cache-Control', 'no-store').json(data);
  }
}

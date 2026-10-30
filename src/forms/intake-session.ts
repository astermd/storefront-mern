import { Inject, Injectable } from '@nestjs/common';
import { Event } from '@astermd-hq/sdk';
import { INTAKE_GATEWAY } from '../core/tokens';
import { FurthestStep } from '../funnel/furthest-step';
import { JourneyStoreFactory } from '../journey/journey-store-factory';
import { ConfigService } from '../support/config';
import { OperatorLog } from '../support/operator-log';
import { AnswerEncoder } from './answer-encoder';
import { AnswerSet } from './answer-set';
import { AnswerValidator } from './answer-validator';
import { Definition } from './definition';
import { Disqualification } from './disqualification';
import { DisqualificationOutcome } from './disqualification-outcome';
import { FileReference, StoredFile } from './file-reference';
import { FileRules } from './file-rules';
import { FormUnavailable } from './form-unavailable';
import { IntakeGateway } from './intake-gateway';
import { IntakeResult } from './intake-result';
import { IntakeView } from './intake-view';
import { LeadOutcome } from './lead-outcome';
import { LeadWriter } from './lead-writer';
import { RecordMapper } from './record-mapper';
import { TeleformMetadata } from './teleform-metadata';
import { TeleformSource } from './teleform-source';

const STEP_PREQUALIFICATION = 'prequalification';
const STEP_INTAKE = 'intake';

/**
 * Ported from storefront-lamp/core/Forms/IntakeSession.php. One visitor's pass through one
 * questionnaire: what to render, what a step advance does, and what a submission decides.
 *
 * The ordering inside `save()`/`submit()` is the substance of this class and is not arbitrary.
 * Answers are persisted **before** anything is validated, evaluated or sent anywhere, because a
 * visitor whose answers vanish because a later step threw is the failure this ordering exists to
 * prevent. Only once they are safely stored does the rest happen — and of that rest, only one
 * outcome may stop the visitor: a failed submission record or a failed lead write is swallowed and
 * logged, because losing a save is better than trapping someone inside a medical questionnaire
 * (`[10.26]`, `[20.2]`). A matched hard rule always stops them (`[10.44a]`). Nothing else does.
 */
@Injectable()
export class IntakeSession {
  static readonly STEP_PREQUALIFICATION = STEP_PREQUALIFICATION;
  static readonly STEP_INTAKE = STEP_INTAKE;

  private readonly collectsFiles: boolean;

  constructor(
    private readonly source: TeleformSource,
    private readonly journeyStoreFactory: JourneyStoreFactory,
    private readonly validator: AnswerValidator,
    private readonly disqualification: Disqualification,
    @Inject(INTAKE_GATEWAY) private readonly submissions: IntakeGateway,
    private readonly leads: LeadWriter,
    private readonly mapper: RecordMapper,
    private readonly log: OperatorLog,
    private readonly config: ConfigService,
  ) {
    // The hosted engine keeps a picked file's name and never its bytes, so under it a file or a
    // signature cannot be collected.
    this.collectsFiles = config.intake.renderer !== 'js-engine';
  }

  /** @throws {FormUnavailable} when the definition can be neither fetched nor served from cache */
  async open(teleformId: string, step: string): Promise<IntakeView> {
    const definition = await this.definition(teleformId);
    const metadata = await this.metadata(teleformId);
    const state = this.journeyStoreFactory.get().currentState();
    const answers = await this.answers(teleformId, definition);

    const [initiated] = IntakeSession.events(step);

    // Fired only if the EMR has not already recorded it (`[4.13]`): a returning visitor who
    // re-opens the form must not produce a second lead record.
    if (state !== null && !state.hasEmrEvent(initiated)) {
      const recorded = await this.submissions.record(
        this.journeyStoreFactory.get().sessionUuid() ?? '',
        initiated,
        teleformId,
        AnswerEncoder.encode(definition, answers),
        IntakeSession.position(1, definition),
      );

      if (recorded) {
        state.recordEmrEvent(initiated);
      }
    }

    return new IntakeView(
      definition,
      metadata,
      answers,
      {},
      this.standingTermination(teleformId, definition),
      definition.unsupportedTypes(this.collectsFiles),
      this.disqualification.rulesFor(teleformId, definition),
    );
  }

  /**
   * One step advance: store what arrived, decide whether the journey may go on, and report
   * anything the visitor has to fix.
   *
   * @throws {FormUnavailable}
   */
  async save(teleformId: string, step: string, posted: Record<string, unknown>, pageIndex: number): Promise<IntakeResult> {
    const definition = await this.definition(teleformId);
    const answers = await this.store(teleformId, definition, posted);

    const outcome = this.disqualification.evaluate(teleformId, definition, answers);
    if (outcome.isHard()) {
      return this.stop(teleformId, outcome);
    }

    this.lift(teleformId);

    // Clamped, so a posted page number past the end cannot select no page at all and thereby
    // validate nothing.
    const errors = this.validator.validate(definition, answers, Math.max(0, Math.min(pageIndex, definition.pageCount() - 1)));
    if (Object.keys(errors).length > 0) {
      return IntakeResult.invalid(errors);
    }

    const [, inProgress] = IntakeSession.events(step);
    await this.report(teleformId, definition, answers, inProgress, IntakeSession.position(pageIndex + 2, definition));

    return IntakeResult.saved();
  }

  /**
   * Final submission. Every page is validated, not just the last, and a matched hard rule refuses
   * the completion even when every field is valid.
   *
   * @throws {FormUnavailable}
   */
  async submit(teleformId: string, step: string, posted: Record<string, unknown>): Promise<IntakeResult> {
    const definition = await this.definition(teleformId);
    const answers = await this.store(teleformId, definition, posted);

    const unsupported = definition.unsupportedTypes(this.collectsFiles);
    if (unsupported.length > 0) {
      // Refusing here rather than accepting a form with missing answers is the whole point of
      // `[10.13]`: a clinician must never read an intake that silently dropped a question.
      this.log.warning('intake.submission_blocked_unsupported_types', { teleform: teleformId, types: unsupported.join(',') });

      return IntakeResult.invalid({
        _form: `This questionnaire contains a question we cannot collect here (${unsupported.join(', ')}). Please contact us and we will complete it with you.`,
      });
    }

    const outcome = this.disqualification.evaluate(teleformId, definition, answers);
    if (outcome.isHard()) {
      return this.stop(teleformId, outcome);
    }

    this.lift(teleformId);

    const errors = this.validator.validate(definition, answers, null);
    if (Object.keys(errors).length > 0) {
      return IntakeResult.invalid(errors);
    }

    const [, , completed] = IntakeSession.events(step);
    await this.report(teleformId, definition, answers, completed, IntakeSession.position(definition.pageCount(), definition));

    const state = this.journeyStoreFactory.get().currentState();
    if (state !== null) {
      state.markFormCompleted(teleformId);

      // `[21.7]`: forwards only.
      FurthestStep.advance(state, step);
    }

    return IntakeResult.finished();
  }

  /**
   * Early capture (`[9.4]`): store what has been typed so far and write the lead if it has crossed
   * the threshold.
   *
   * Deliberately not routed through `save()`. A capture fires on a field blur, so by definition the
   * page is half-answered — running page validation first would refuse every real capture.
   *
   * @throws {FormUnavailable}
   */
  async capture(teleformId: string, posted: Record<string, unknown>): Promise<LeadOutcome> {
    const definition = await this.definition(teleformId);
    const answers = await this.store(teleformId, definition, posted);

    const state = this.journeyStoreFactory.get().currentState();
    const session = this.journeyStoreFactory.get().sessionUuid() ?? '';
    if (state === null || session === '') {
      return LeadOutcome.noneCreated();
    }

    return this.leads.capture(session, state, this.mapper.build(await this.metadata(teleformId), answers, definition));
  }

  /**
   * The rules for one file-upload question on this form, or null when the form asks no such
   * question by that name — which is what stops the upload endpoints relaying a file for a
   * question that is not there.
   *
   * @throws {FormUnavailable}
   */
  async fileRulesFor(teleformId: string, fieldName: string): Promise<FileRules | null> {
    if (!this.collectsFiles) return null;

    const field = (await this.definition(teleformId)).field(fieldName);

    return field !== null && field.isFileUpload() ? FileRules.for(field) : null;
  }

  /** The definition exactly as it was authored, for the renderer that hands it to the hosted engine. */
  async rawDefinition(teleformId: string): Promise<Record<string, unknown>> {
    return this.source.definitionFor(teleformId);
  }

  /** Stored answers in the shape a renderer wants for its `initialValues`. */
  async initialValues(teleformId: string): Promise<Record<string, unknown>> {
    return (await this.answers(teleformId, await this.definition(teleformId))).all();
  }

  /** Merges what arrived into what was already known and persists it before anything else can fail (`[10.27]`). */
  private async store(teleformId: string, definition: Definition, posted: Record<string, unknown>): Promise<AnswerSet> {
    const state = this.journeyStoreFactory.get().currentState();
    const stored = state === null ? {} : state.answersFor(teleformId);

    const answers = (await this.answers(teleformId, definition)).merge(this.ownFiles(posted, definition), definition).withDerived(definition);

    // Answers to questions the form no longer asks are carried through rather than dropped — a
    // republished form that removes a question must not destroy what was already answered.
    state?.storeAnswers(teleformId, { ...IntakeSession.orphans(stored, definition), ...answers.all() });
    if (state !== null && state !== undefined) {
      state.identityDocument = this.identityDocumentIn(definition, answers) ?? state.identityDocument;
    }

    return answers;
  }

  /**
   * The EMR path of the visitor's ID document: the first file uploaded to a file-upload question
   * whose label or name matches `verification.documentFieldPattern`. Null when there is none — a
   * form with other uploads (lab results, say) must not have one of them reported as an ID.
   */
  private identityDocumentIn(definition: Definition, answers: AnswerSet): string | null {
    const source = this.config.verification.documentFieldPattern;
    if (source === undefined || source === '') return null;

    let pattern: RegExp;
    try {
      pattern = new RegExp(source, 'i');
    } catch {
      return null;
    }

    for (const field of definition.fields()) {
      if (!field.isFileUpload() || !(pattern.test(field.label) || pattern.test(field.name))) continue;

      const value = answers.value(field.name);
      for (const entry of Array.isArray(value) ? value : [value]) {
        const reference = FileReference.fromArray(entry);
        if (reference !== null) return reference.path;
      }
    }

    return null;
  }

  /**
   * The posted answers with every file reference that is not this visitor's taken out of them.
   *
   * The page posts what the upload endpoints answered, and nothing stops a request posting another
   * path instead. A reference is kept only when the EMR filed it under this journey's session,
   * which no other visitor's upload can be (`FileReference.belongsTo()`). A journey with no session
   * keeps none, since none of its uploads could have been made.
   */
  private ownFiles(posted: Record<string, unknown>, definition: Definition): Record<string, unknown> {
    const session = this.journeyStoreFactory.get().sessionUuid() ?? '';
    const own = { ...posted };

    for (const [name, value] of Object.entries(posted)) {
      const field = definition.field(name);
      if (field === null || !field.isFileUpload()) continue;

      const kept: StoredFile[] = [];
      for (const entry of Array.isArray(value) ? value : [value]) {
        const reference = FileReference.fromPosted(entry);
        if (reference === null) continue;

        if (session === '' || !reference.belongsTo(session)) {
          this.log.warning('intake.foreign_file_refused', { field: field.name });
          continue;
        }

        kept.push(reference.toArray());
      }

      own[name] = kept;
    }

    return own;
  }

  /** The stored answers, filtered to what the form still asks (`[9.12]`). */
  private async answers(teleformId: string, definition: Definition): Promise<AnswerSet> {
    const state = this.journeyStoreFactory.get().currentState();
    const stored = state === null ? {} : state.answersFor(teleformId);

    return AnswerSet.fromArray(IntakeSession.declaredOnly(stored, definition)).withDerived(definition);
  }

  private static orphans(answers: Record<string, unknown>, definition: Definition): Record<string, unknown> {
    const orphans: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(answers)) {
      if (definition.field(name) === null) orphans[name] = value;
    }
    return orphans;
  }

  private static declaredOnly(answers: Record<string, unknown>, definition: Definition): Record<string, unknown> {
    const kept: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(answers)) {
      const field = definition.field(name);
      if (field !== null && !field.isDisplayOnly()) kept[name] = value;
    }
    return kept;
  }

  /**
   * Records the disqualification and reports it. The cart line that triggered it is deliberately
   * left alone: clearing it here would empty the drawer while the visitor is still reading why.
   */
  private stop(teleformId: string, outcome: DisqualificationOutcome): IntakeResult {
    const ruleId = outcome.ruleId() ?? '';
    this.journeyStoreFactory.get().currentState()?.recordDisqualification(teleformId, ruleId);

    this.log.info('intake.disqualified', { teleform: teleformId, rule: ruleId });

    return IntakeResult.stopped(ruleId, outcome.message() ?? '');
  }

  /** Withdraws a standing disqualification once the answers no longer trip any hard rule. */
  private lift(teleformId: string): void {
    const state = this.journeyStoreFactory.get().currentState();
    if (state === null || !state.isDisqualified() || state.disqualifiedTeleform !== teleformId) return;

    this.log.info('intake.disqualification_lifted', { teleform: teleformId, rule: state.disqualifiedRule });
    state.clearDisqualification();
  }

  /** The two swallowed writes: the submission record and the lead. */
  private async report(
    teleformId: string,
    definition: Definition,
    answers: AnswerSet,
    event: Event,
    progress: { page: number; total: number } | null,
  ): Promise<void> {
    const session = this.journeyStoreFactory.get().sessionUuid() ?? '';
    if (session !== '') {
      await this.submissions.record(session, event, teleformId, AnswerEncoder.encode(definition, answers), progress);
    }

    const state = this.journeyStoreFactory.get().currentState();
    if (state === null || session === '') return;

    await this.leads.capture(session, state, this.mapper.build(await this.metadata(teleformId), answers, definition));
  }

  /** The message a journey already stopped on this form should still be shown on re-entry (`[10.48]`). */
  private standingTermination(teleformId: string, definition: Definition): string | null {
    const state = this.journeyStoreFactory.get().currentState();
    if (state === null || !state.isDisqualified() || state.disqualifiedTeleform !== teleformId) return null;

    for (const rule of this.disqualification.rulesFor(teleformId, definition)) {
      if (rule.id === state.disqualifiedRule) return rule.message;
    }

    return null;
  }

  private async definition(teleformId: string): Promise<Definition> {
    return Definition.fromArray(await this.source.definitionFor(teleformId));
  }

  private async metadata(teleformId: string): Promise<TeleformMetadata> {
    const metadata = await this.source.metadataFor(teleformId);
    if (metadata === null) {
      throw new FormUnavailable(`No teleform metadata for "${teleformId}".`);
    }
    return metadata;
  }

  /** The visitor's position as a page/total pair, 1-based and clamped to the form's real page count (`[10.24]`). */
  private static position(page: number, definition: Definition): { page: number; total: number } | null {
    const total = definition.pageCount();
    if (total < 1) return null;

    return { page: Math.max(1, Math.min(page, total)), total };
  }

  /** [initiated, in-progress, completed] */
  private static events(step: string): [Event, Event, Event] {
    return step === STEP_PREQUALIFICATION
      ? [Event.PreQualifyingInitiated, Event.PreQualifyingInProgress, Event.PreQualifyingCompleted]
      : [Event.IntakeInitiated, Event.IntakeInProgress, Event.IntakeCompleted];
  }
}

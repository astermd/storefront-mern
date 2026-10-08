import { AnswerSet } from './answer-set';
import { Definition } from './definition';
import { TeleformMetadata } from './teleform-metadata';
import { TerminationRule } from './termination-rule';

/**
 * Ported from storefront-lamp/core/Forms/IntakeView.php. Everything a renderer needs to draw the
 * form once, gathered so the controller performs one read rather than each template fetching its
 * own.
 *
 * `rules` is handed to the page so the client can show an ineligibility notice the moment an
 * answer is given (`[10.44]`) instead of a round trip later. It carries no authority: the same
 * rules are re-evaluated on the server on every save and on submit (`[10.45]`), so a tampered
 * client can only change what the visitor sees, never whether they may proceed.
 */
export class IntakeView {
  constructor(
    public readonly definition: Definition,
    public readonly metadata: TeleformMetadata,
    public readonly answers: AnswerSet,
    /** field name -> message, empty on a first render */
    public readonly errors: Record<string, string>,
    public readonly terminationMessage: string | null,
    /** types the renderer cannot draw (`[10.13]`) */
    public readonly unsupportedTypes: string[],
    public readonly rules: TerminationRule[],
  ) {}

  blocked(): boolean {
    return this.unsupportedTypes.length > 0;
  }
}

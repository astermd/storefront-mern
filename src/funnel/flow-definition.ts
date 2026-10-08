import { Url } from '../support/url';

export interface StepDefinition {
  path: string;
  requires: string[];
}

/**
 * Ported from storefront-lamp/core/Funnel/FlowDefinition.php. The funnel as data: which URL is
 * which named step, and what that step requires before a visitor may enter it (`[22.1]`, `[8.8]`),
 * read once from `config/funnel.ts` rather than re-derived by whoever needs it.
 *
 * Every declared path is canonicalised at construction, and every path handed to `stepForPath()`
 * is canonicalised through the same `Url.canonicalizePath()` the redirect middleware itself uses —
 * so a case-different or slash-less spelling of a guarded URL can never slip past the guard.
 */
export class FlowDefinition {
  /** The step every failed routing decision falls back to. */
  static readonly ENTRY_STEP = 'home';

  private readonly steps: Record<string, StepDefinition>;
  private readonly stepsByPath: Record<string, string>;

  constructor(steps: Record<string, { path: string; requires?: string[] }>) {
    const normalised: Record<string, StepDefinition> = {};
    const byPath: Record<string, string> = {};

    for (const [name, definition] of Object.entries(steps)) {
      const path = Url.canonicalizePath(definition.path ?? '');
      const requires = (definition.requires ?? []).map(String);

      normalised[name] = { path, requires };
      byPath[path] = name;
    }

    this.steps = normalised;
    this.stepsByPath = byPath;
  }

  stepForPath(path: string): string | null {
    return this.stepsByPath[Url.canonicalizePath(path)] ?? null;
  }

  /** @throws Error when `step` names no configured step — a redirect target that silently becomes '' is a redirect to nowhere. */
  pathFor(step: string): string {
    const definition = this.steps[step];
    if (!definition) {
      throw new Error(`Unknown funnel step "${step}".`);
    }
    return definition.path;
  }

  /** @throws Error when `step` names no configured step. */
  requirementsFor(step: string): string[] {
    const definition = this.steps[step];
    if (!definition) {
      throw new Error(`Unknown funnel step "${step}".`);
    }
    return definition.requires;
  }

  allSteps(): Record<string, StepDefinition> {
    return this.steps;
  }
}

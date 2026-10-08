import { Definition } from './definition';
import { Page } from './page';

/** Titles the form builder generates when the author never set one. They name nothing, so they are not used. */
const PLACEHOLDER_TITLE = /^page\s*\d+$/i;

export interface ProgressStep {
  label: string;
  icon: null;
}

/**
 * Ported from storefront-lamp/core/Forms/ProgressSteps.php. The steps drawn above a questionnaire,
 * derived from the questionnaire.
 *
 * Two sources, in priority order: an authored `form-progress` field's `progressStepItems` outrank
 * anything derived, since the form author is saying what the steps are. Otherwise one step per
 * page — the page's own title, unless it's the builder's `Page N` placeholder, then the page's
 * first heading field, then the position.
 *
 * No icons. The EMR names none, and inventing one per step would attach a meaning to pages that do
 * not have it.
 */
export class ProgressSteps {
  static from(definition: Definition): ProgressStep[] {
    const authored = ProgressSteps.authored(definition);
    return authored.length > 0 ? authored : ProgressSteps.fromPages(definition);
  }

  /**
   * The steps an author declared on a `form-progress` field.
   *
   * Ordered by the page each item names rather than by array order, since the builder appends a
   * new item at the end whatever page it is given. Items with no usable text are dropped, and a
   * field whose items are all unusable falls through to the pages.
   */
  private static authored(definition: Definition): ProgressStep[] {
    for (const field of definition.fields()) {
      if (field.type !== 'form-progress') continue;

      const items = field.properties.progressStepItems;
      if (!Array.isArray(items)) continue;

      const ordered: Array<[number, number, string]> = [];
      items.forEach((item, index) => {
        if (!item || typeof item !== 'object') return;

        const record = item as Record<string, unknown>;
        const text = String(record.text ?? '').trim();
        if (text === '') return;

        // `page` is one-based where it is given at all; the written position is the tiebreak so
        // two items on one page keep the order they were authored in.
        const page = typeof record.page === 'number' ? record.page : Number(record.page);
        ordered.push([Number.isNaN(page) ? Number.MAX_SAFE_INTEGER : page, index, text]);
      });

      if (ordered.length === 0) continue;

      ordered.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

      return ordered.map(([, , label]) => ({ label, icon: null }));
    }

    return [];
  }

  private static fromPages(definition: Definition): ProgressStep[] {
    return definition.pages().map((page, index) => ({ label: ProgressSteps.labelFor(page, index), icon: null }));
  }

  private static labelFor(page: Page, index: number): string {
    const title = (page.title ?? '').trim();
    if (title !== '' && !PLACEHOLDER_TITLE.test(title)) return title;

    for (const field of page.fields) {
      if (field.type === 'heading' && field.label.trim() !== '') return field.label.trim();
    }

    return `Step ${index + 1}`;
  }
}

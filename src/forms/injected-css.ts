/**
 * Ported from storefront-lamp/core/Forms/InjectedCss.php. The form author's own stylesheet
 * (`settings.injectCss`), made safe to put inside a `<style>` element.
 *
 * **Why this is not HTML escaping.** CSS cannot survive it: `>` is the child combinator, `&` is
 * nesting, `"` appears in every attribute selector. Escaping would turn a working stylesheet into a
 * broken one while protecting nothing that matters. The template renders this raw (unescaped), and
 * this class is what earns that.
 *
 * **What actually has to be removed.** Inside `<style>` the HTML parser is in RAWTEXT mode: it does
 * not interpret tags, entities or comments, and the only thing that ends the element is a closing
 * `</style` tag. So that one sequence is the whole attack surface.
 *
 * **Deleting it once is not enough.** `</sty</stylele>` holds exactly one `</style`, in the middle;
 * remove it and the surviving `</sty` and `le>` splice into a working `</style>`. So removal
 * repeats until the text stops changing, and the loop is bounded by the fact that each pass
 * strictly shortens the string.
 */
export class InjectedCss {
  /** `</style`, tolerating the whitespace the HTML parser tolerates. */
  private static readonly CLOSING_TAG = /<\/\s*style/gi;

  static safe(css: string | null): string | null {
    if (css === null || css.trim() === '') return null;

    let safe = css;
    let previous: string;
    do {
      previous = safe;
      safe = previous.replace(InjectedCss.CLOSING_TAG, '');
    } while (safe !== previous);

    return safe.trim() === '' ? null : safe;
  }
}

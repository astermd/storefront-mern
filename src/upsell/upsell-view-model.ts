/**
 * Ported from storefront-lamp/core/Upsell/UpsellViewModel.php. Everything the upsell page renders,
 * assembled once on the server — the template resolves nothing.
 *
 * `acceptPath`/`declinePath` are on the model rather than hardcoded in the template so the page is
 * correct with JavaScript off: both buttons are real form posts to real routes, from the flow
 * definition rather than a string baked into a template.
 *
 * `position`/`total` are `[16.3]`'s one-offer-per-step made visible — counting only offers that can
 * actually be put, so a queue with a dead entry in it never promises a screen that never arrives.
 *
 * Deliberately **no notice field** — a flood refusal and a charge that may still be in flight are
 * flashed through the cart notice sink, the same one every other flashed message uses.
 */
export class UpsellViewModel {
  constructor(
    public readonly key: string,
    public readonly eyebrow: string,
    public readonly headline: string,
    public readonly body: string,
    public readonly bullets: string[],
    public readonly image: string | null,
    public readonly productName: string,
    public readonly priceCents: number,
    public readonly currency: string,
    public readonly acceptLabel: string,
    public readonly declineLabel: string,
    public readonly footnote: string | null,
    public readonly acceptPath: string,
    public readonly declinePath: string,
    public readonly position: number,
    public readonly total: number,
  ) {}
}

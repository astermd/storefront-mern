/**
 * Ported from storefront-lamp/core/Checkout/ConsentDefinition.php. One configured consent control
 * (`[26.3]`, `[26.8]`).
 *
 * `links` duplicates the hrefs already inside `html` on purpose: a deploy-time check that every
 * legal document resolves (`[26.9]`) needs them as data, and parsing them back out of markup would
 * break the moment someone writes an href with single quotes.
 */
export class ConsentDefinition {
  constructor(
    public readonly key: string,
    public readonly label: string,
    public readonly html: string,
    public readonly blocking: boolean,
    public readonly links: string[],
  ) {}
}

/**
 * Ported from storefront-lamp/core/Forms/FormUnavailable.php. Thrown when a definition can be
 * neither fetched nor served from cache.
 *
 * Exists so the controller can render an explicit "form unavailable" page (`[10.3]`) rather than an
 * empty or half-drawn form. Deliberately not a swallowed failure: an intake step with no questions
 * looks like a working page and would collect nothing, which is worse than a stated outage.
 */
export class FormUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormUnavailable';
  }
}

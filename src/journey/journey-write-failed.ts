/**
 * Ported from storefront-lamp/core/Journey/JourneyWriteFailed.php. Thrown by `JourneyStore.flush()`
 * when a write matched no row. Composed from the session uuid and nothing else — see
 * `JourneyStore`'s doc comment for why that is what makes it safe to log in full.
 */
export class JourneyWriteFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JourneyWriteFailed';
  }
}

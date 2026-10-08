/**
 * Ported from storefront-lamp/core/Observability/Measured.php. A monitored figure, or the reason
 * there isn't one.
 *
 * **Zero and "could not be counted" are different answers**, and a status surface that renders them
 * the same is worse than no surface at all: it reports an all-clear on exactly the runs that could
 * see nothing. This codebase's PHP original shipped that defect once already — a reverse sweep
 * printing "0 lost charges" and exiting 0 when the local read had failed outright — so every count
 * `[20.12]` asks for travels in this object rather than as a bare number.
 *
 * Four states: `measured` (counted, complete), `floor` (counted, known to be a lower bound — a
 * truncated provider window), `not_checked` (nobody asked — the provider half is opt-in and this is
 * its ordinary state, never zero), `unavailable` (asked, and not answered).
 */
export class Measured {
  static readonly MEASURED = 'measured';
  static readonly FLOOR = 'floor';
  static readonly NOT_CHECKED = 'not_checked';
  static readonly UNAVAILABLE = 'unavailable';

  private constructor(
    public readonly value: number | null,
    public readonly state: string,
    public readonly failure: string | null = null,
  ) {}

  static of(value: number): Measured {
    return new Measured(value, Measured.MEASURED);
  }

  /** A real count over an incomplete window: the total is at least this. */
  static floor(value: number): Measured {
    return new Measured(value, Measured.FLOOR);
  }

  static notChecked(): Measured {
    return new Measured(null, Measured.NOT_CHECKED);
  }

  static unavailable(failure: string): Measured {
    return new Measured(null, Measured.UNAVAILABLE, failure);
  }

  /** Whether a caller may draw any conclusion from `value`. */
  available(): boolean {
    return this.value !== null;
  }

  /** Whether this figure is a complete answer — separate from `available()`, since a floor is a usable number and still not an answer. */
  complete(): boolean {
    return this.state === Measured.MEASURED;
  }

  render(): string {
    switch (this.state) {
      case Measured.MEASURED:
        return String(this.value);
      case Measured.FLOOR:
        return `at least ${this.value}`;
      case Measured.NOT_CHECKED:
        return 'not checked';
      default:
        return `unavailable (${this.failure ?? 'unknown'})`;
    }
  }

  toArray(): { value: number | null; state: string; failure: string | null } {
    return { value: this.value, state: this.state, failure: this.failure };
  }
}

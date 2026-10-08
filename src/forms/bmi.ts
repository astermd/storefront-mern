/**
 * Ported from storefront-lamp/core/Forms/Bmi.php. The body-mass-index arithmetic, as a pure
 * function of a unit system, a height and a weight.
 *
 * A class of its own rather than a private helper on `AnswerSet` because the score is a *clinical*
 * number that a hard-stop rule compares against (`[10.41c]`): a form may disqualify on "BMI below
 * 27", so the rounding, the unit classification and the band boundaries are all observable
 * behaviour that deserves its own tests.
 *
 * Every entry point either returns a real measurement or returns nothing. There is deliberately no
 * "0.0 means unknown" path: zero satisfies every below-threshold comparison, so a sentinel score
 * would disqualify a visitor who has merely not finished typing.
 */
export class Bmi {
  static readonly METRIC = 'metric';
  static readonly IMPERIAL = 'imperial';

  /**
   * Keywords that mark a unit label as metric (`[10.29]`). Checked before anything else so a
   * compound label like "Metric (kg/cm)" cannot be misread by an imperial keyword hiding inside
   * it.
   */
  private static readonly METRIC_KEYWORDS = ['metric', 'kg', 'kilo', 'cm', 'centimet'];

  /**
   * Classifies the unit system a BMI composite was answered in.
   *
   * Imperial is the default, and that default is load-bearing: the recorded form carries its unit
   * system in a *hidden* dropdown, so the visitor never picks one and the answer arrives absent.
   * The same form labels its inputs "Height (in inches)" and "Weight (in lbs)", so treating an
   * unstated system as imperial is what matches the numbers actually typed.
   */
  static unitSystem(raw: string | null): string {
    const normalised = (raw ?? '').toLowerCase().trim();

    for (const keyword of Bmi.METRIC_KEYWORDS) {
      if (normalised !== '' && normalised.includes(keyword)) {
        return Bmi.METRIC;
      }
    }

    return Bmi.IMPERIAL;
  }

  /**
   * The score to one decimal place, or null when the inputs are not a measurement (`[10.31]`).
   *
   * Metric reads centimetres and kilograms (`kg / m²`); imperial reads inches and pounds
   * (`lb / in² × 703`). A non-positive height would be a division by zero, and a non-positive
   * weight would produce a zero score that reads as "extremely underweight" — both are absent
   * measurements, not measurements of zero, so both return null.
   */
  static score(unitSystem: string, height: number, weight: number): number | null {
    if (height <= 0.0 || weight <= 0.0) return null;

    if (unitSystem === Bmi.METRIC) {
      const metres = height / 100;
      return Math.round((weight / metres ** 2) * 10) / 10;
    }

    return Math.round(((weight / height ** 2) * 703) * 10) / 10;
  }

  /** The standard weight band for a score (`[10.33]`). */
  static category(score: number): string {
    if (score < 18.5) return 'Underweight';
    if (score < 25.0) return 'Normal';
    if (score < 30.0) return 'Overweight';
    return 'Obese';
  }
}

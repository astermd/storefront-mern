import { Bmi } from '../../src/forms/bmi';

describe('Bmi', () => {
  describe('unitSystem', () => {
    it('defaults to imperial when unstated', () => {
      expect(Bmi.unitSystem(null)).toBe('imperial');
      expect(Bmi.unitSystem('')).toBe('imperial');
    });

    it('recognises metric keywords', () => {
      expect(Bmi.unitSystem('Metric (kg/cm)')).toBe('metric');
      expect(Bmi.unitSystem('kg')).toBe('metric');
      expect(Bmi.unitSystem('centimetres')).toBe('metric');
    });

    it('is case-insensitive and trims', () => {
      expect(Bmi.unitSystem('  METRIC  ')).toBe('metric');
    });
  });

  describe('score', () => {
    it('computes imperial: lb / in^2 * 703', () => {
      expect(Bmi.score('imperial', 70, 180)).toBeCloseTo(25.8, 1);
    });

    it('computes metric: kg / m^2', () => {
      expect(Bmi.score('metric', 178, 81)).toBeCloseTo(25.6, 1);
    });

    it('returns null for non-positive height or weight rather than a sentinel zero', () => {
      expect(Bmi.score('imperial', 0, 180)).toBeNull();
      expect(Bmi.score('imperial', 70, 0)).toBeNull();
      expect(Bmi.score('imperial', -5, 180)).toBeNull();
    });
  });

  describe('category', () => {
    it('classifies the standard bands', () => {
      expect(Bmi.category(18.0)).toBe('Underweight');
      expect(Bmi.category(22.0)).toBe('Normal');
      expect(Bmi.category(27.0)).toBe('Overweight');
      expect(Bmi.category(31.0)).toBe('Obese');
    });

    it('treats the boundaries as belonging to the higher band', () => {
      expect(Bmi.category(18.5)).toBe('Normal');
      expect(Bmi.category(25.0)).toBe('Overweight');
      expect(Bmi.category(30.0)).toBe('Obese');
    });
  });
});

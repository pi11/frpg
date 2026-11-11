import { describe, expect, it } from 'vitest';
import { Rng } from './rng';

describe('seeded gameplay RNG', () => {
  it('repeats the same sequence for the same seed', () => {
    const first = new Rng(12345);
    const second = new Rng(12345);
    expect(Array.from({ length: 20 }, () => first.next()))
      .toEqual(Array.from({ length: 20 }, () => second.next()));
  });

  it('returns values in [0, 1)', () => {
    const rng = new Rng(0);
    for (let index = 0; index < 1000; index += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

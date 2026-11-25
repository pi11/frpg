import { describe, expect, it } from 'vitest';
import { refillBudget, softCap } from './limits';

describe('limits', () => {
  it('weakens only the part above the soft cap', () => {
    expect(softCap(120, 150, 0.4)).toBe(120);
    expect(softCap(200, 150, 0.4)).toBe(170);
  });

  it('refills at a steady rate and never stores more than a second', () => {
    expect(refillBudget(0, 200, 500)).toBe(100);
    expect(refillBudget(150, 200, 5000)).toBe(200);
    expect(refillBudget(Infinity, 200, 16)).toBe(200);
  });
});

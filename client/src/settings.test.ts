import { describe, expect, it } from 'vitest';
import { volume } from './settings';

describe('volume settings', () => {
  it('keeps numbers in range and understands the old switches', () => {
    expect(volume(0.4, 1)).toBe(0.4);
    expect(volume(7, 1)).toBe(1);
    expect(volume(-1, 1)).toBe(0);
    expect(volume(true, 1)).toBe(1);
    expect(volume(false, 1)).toBe(0);
    expect(volume('loud', 1)).toBe(1);
    expect(volume(NaN, 1)).toBe(1);
  });
});

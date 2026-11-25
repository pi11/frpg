import { describe, expect, it } from 'vitest';
import { getCatalog } from './catalog';
import { levelChanges, statBonus } from './statText';

describe('upgrade texts', () => {
  it('shows fractions as percent without float noise', () => {
    expect(statBonus('luck', 0.05 * 3)).toBe('+15% удача');
    expect(statBonus('regen', 0.1 * 3)).toBe('+0.3 регенерация');
    expect(statBonus('moveSpeed', 0.1, 'percent')).toBe('+10% скорость');
  });

  it('lists only what changes between weapon levels', () => {
    const [first, second] = getCatalog().weapons.tesla_coil!.levels;
    expect(levelChanges(first!, second!)).toEqual(['урон 9>11', 'перезарядка 1.3с>1.25с', 'скачки 2>3']);
    expect(levelChanges(first!, first!)).toEqual([]);
  });

  it('describes every weapon level-up', () => {
    for (const weapon of Object.values(getCatalog().weapons)) {
      for (let index = 1; index < weapon.levels.length; index += 1) {
        expect(levelChanges(weapon.levels[index - 1]!, weapon.levels[index]!).length, weapon.id)
          .toBeGreaterThan(0);
      }
    }
  });
});

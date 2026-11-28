import { describe, expect, it } from 'vitest';
import { getCatalog } from './catalog';
import { evolutionChanges, heroTraits, levelChanges, levelStats, statBonus } from './statText';

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

  it('shows the power gain of an evolution first, then every changed number', () => {
    const { weapons } = getCatalog();
    const lines = evolutionChanges(weapons.scrap_pistol!.levels.at(-1)!, weapons.nail_gun!.levels[0]!);
    expect(lines[0]).toMatch(/^сила ×\d+(,\d)?$/);
    expect(lines).toContain('урон 20>24');
    expect(lines).toContain('пробой 0>2');
  });

  it('separates strengths and weaknesses of heroes', () => {
    const { heroes } = getCatalog();
    const { good, bad } = heroTraits(heroes.bruiser!, heroes.wanderer!);
    expect(good).toContain('+60 здоровье');
    expect(bad).toContain('-10% скорость атаки');
    expect(heroTraits(heroes.wanderer!, heroes.wanderer!)).toEqual({ good: [], bad: [] });
    for (const hero of Object.values(heroes)) {
      if (hero.unlock.type === 'default') continue;
      const traits = heroTraits(hero, heroes.wanderer!);
      expect(traits.good.length, hero.id).toBeGreaterThan(0);
      expect(traits.bad.length, hero.id).toBeGreaterThan(0);
    }
  });

  it('lists weapon numbers for tooltips', () => {
    expect(levelStats(getCatalog().weapons.tesla_coil!.levels[0]!))
      .toEqual(['урон 9', 'перезарядка 1.3с', 'кол-во 1', 'скачки 2']);
    expect(statBonus('killHeal', 0.06)).toBe('+0.06 здоровье за убийство');
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

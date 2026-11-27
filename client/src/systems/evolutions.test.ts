import { describe, expect, it } from 'vitest';
import { getCatalog } from '../content/catalog';
import { availableEvolutions, evolutionSource } from './evolutions';

describe('weapon evolutions', () => {
  const { weapons, passives } = getCatalog();
  const base = Object.values(weapons).filter((weapon) => weapon.evolutions.length);

  it('gives every base weapon two paths with different perks and distinct evolved weapons', () => {
    expect(base.length).toBe(Object.values(weapons).filter((weapon) => !weapon.evolved && !weapon.heavy).length);
    for (const weapon of base) {
      expect(weapon.evolutions.length, weapon.id).toBe(2);
      expect(new Set(weapon.evolutions.map((path) => path.passive)).size, weapon.id).toBe(2);
      for (const { passive, into } of weapon.evolutions) {
        expect(passives[passive]).toBeDefined();
        expect(evolutionSource(weapons, into)?.id).toBe(weapon.id);
      }
    }
  });

  it('needs the last weapon level, the passive and no evolved copy yet', () => {
    const weapon = weapons.laser_rifle!;
    const { passive, into } = weapon.evolutions[0]!;
    const max = weapon.levels.length;
    const check = (level: number, passiveLevel: number, extra: [string, { level: number }][] = []) =>
      availableEvolutions(weapons, new Map([[weapon.id, { level }], ...extra]),
        new Map([[passive, passiveLevel]]));

    expect(check(max - 1, 1)).toEqual([]);
    expect(check(max, 0)).toEqual([]);
    expect(check(max, 1)).toEqual([{ from: weapon.id, into, passive }]);
    expect(check(max, 1, [[into, { level: 1 }]])).toEqual([]);
  });

  it('offers both paths when both perks are owned', () => {
    const weapon = weapons.scrap_pistol!;
    const [first, second] = weapon.evolutions;
    const options = availableEvolutions(weapons, new Map([[weapon.id, { level: weapon.levels.length }]]),
      new Map([[first!.passive, 1], [second!.passive, 2]]));
    expect(options.map((option) => option.into)).toEqual([first!.into, second!.into]);
  });

  it('makes every evolved weapon stronger per second than the base at its last level', () => {
    for (const weapon of base) {
      const last = weapon.levels.at(-1)!;
      const dps = (level: typeof last) => level.damage * level.shots / level.cooldownMs;
      for (const { into } of weapon.evolutions) {
        expect(dps(weapons[into]!.levels[0]!), into).toBeGreaterThan(dps(last));
      }
    }
  });
});

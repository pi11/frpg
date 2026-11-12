import { describe, expect, it } from 'vitest';
import { getCatalog } from '../content/catalog';
import { availableEvolutions, evolutionSource } from './evolutions';

describe('weapon evolutions', () => {
  const { weapons, passives } = getCatalog();
  const base = Object.values(weapons).filter((weapon) => weapon.evolution);

  it('pairs every base weapon with a passive and a distinct evolved weapon', () => {
    expect(base.length).toBe(Object.values(weapons).filter((weapon) => !weapon.evolved).length);
    for (const weapon of base) {
      expect(passives[weapon.evolution!.passive]).toBeDefined();
      expect(evolutionSource(weapons, weapon.evolution!.into)?.id).toBe(weapon.id);
    }
  });

  it('needs the last weapon level, the passive and no evolved copy yet', () => {
    const weapon = weapons.laser_rifle!;
    const { passive, into } = weapon.evolution!;
    const max = weapon.levels.length;
    const check = (level: number, passiveLevel: number, extra: [string, { level: number }][] = []) =>
      availableEvolutions(weapons, new Map([[weapon.id, { level }], ...extra]),
        new Map([[passive, passiveLevel]]));

    expect(check(max - 1, 1)).toEqual([]);
    expect(check(max, 0)).toEqual([]);
    expect(check(max, 1)).toEqual([{ from: weapon.id, into, passive }]);
    expect(check(max, 1, [[into, { level: 1 }]])).toEqual([]);
  });

  it('makes the evolved weapon stronger per second than the base at its last level', () => {
    for (const weapon of base) {
      const last = weapon.levels.at(-1)!;
      const evolved = weapons[weapon.evolution!.into]!.levels[0]!;
      const dps = (level: typeof last) => level.damage * level.shots / level.cooldownMs;
      expect(dps(evolved), weapon.id).toBeGreaterThan(dps(last));
    }
  });
});

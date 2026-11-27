import type { WeaponDefinition } from '../content/schemas';

export interface EvolutionOption {
  /** Base weapon that is replaced. */
  from: string;
  /** Evolved weapon that takes its place. */
  into: string;
  passive: string;
}

/**
 * Evolutions the hero can take now: the base weapon is at its last level, one of its
 * paired passives is owned at any level, and that evolved weapon is not owned yet.
 * A weapon with two ready paths lists both; taking one replaces the base weapon.
 */
export function availableEvolutions(
  weapons: Readonly<Record<string, WeaponDefinition>>,
  ownedWeapons: ReadonlyMap<string, { level: number }>,
  ownedPassives: ReadonlyMap<string, number>,
): EvolutionOption[] {
  const options: EvolutionOption[] = [];
  for (const [id, state] of ownedWeapons) {
    const weapon = weapons[id];
    if (!weapon || state.level < weapon.levels.length) continue;
    for (const { passive, into } of weapon.evolutions) {
      if (!(ownedPassives.get(passive) ?? 0) || ownedWeapons.has(into)) continue;
      options.push({ from: id, into, passive });
    }
  }
  return options;
}

/** The base weapon that evolves into `into`, if any. */
export function evolutionSource(
  weapons: Readonly<Record<string, WeaponDefinition>>, into: string,
): WeaponDefinition | undefined {
  return Object.values(weapons).find((weapon) => weapon.evolutions.some((path) => path.into === into));
}

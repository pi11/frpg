import type { WeaponDefinition } from '../content/schemas';

export interface EvolutionOption {
  /** Base weapon that is replaced. */
  from: string;
  /** Evolved weapon that takes its place. */
  into: string;
  passive: string;
}

/**
 * Evolutions the hero can take now: the base weapon is at its last level, the paired
 * passive is owned at any level, and the evolved weapon is not owned yet.
 */
export function availableEvolutions(
  weapons: Readonly<Record<string, WeaponDefinition>>,
  ownedWeapons: ReadonlyMap<string, { level: number }>,
  ownedPassives: ReadonlyMap<string, number>,
): EvolutionOption[] {
  const options: EvolutionOption[] = [];
  for (const [id, state] of ownedWeapons) {
    const weapon = weapons[id];
    if (!weapon?.evolution || state.level < weapon.levels.length) continue;
    const { passive, into } = weapon.evolution;
    if (!(ownedPassives.get(passive) ?? 0) || ownedWeapons.has(into)) continue;
    options.push({ from: id, into, passive });
  }
  return options;
}

/** The base weapon that evolves into `into`, if any. */
export function evolutionSource(
  weapons: Readonly<Record<string, WeaponDefinition>>, into: string,
): WeaponDefinition | undefined {
  return Object.values(weapons).find((weapon) => weapon.evolution?.into === into);
}

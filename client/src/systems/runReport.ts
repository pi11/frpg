import type { Profile, RunRecord } from '../api/game';
import type { Catalog } from '../content/catalog';
import { orderedLocations } from '../content/locations';
import type { HeroDefinition, ItemUnlock } from '../content/schemas';
import { upgradeCost } from '../economy';

/**
 * Result-screen texts built from the finished run and the profile the server returned.
 * Pure functions, so every rule is tested without a scene.
 */

/** What the run held at the end: weapon and perk ids with their levels. */
export interface RunBuild {
  weapons: [string, number][];
  passives: [string, number][];
}

export interface DamageRow {
  /** Weapon id; '' is «Другое». */
  id: string;
  name: string;
  sprite: string | null;
  amount: number;
  /** 0..1 of all damage dealt. */
  share: number;
}

const OTHER = 'Другое';

/**
 * The `top` weapons by HP really taken from enemies, then «Другое» for the rest (other
 * weapons, thorns, bonuses). Empty when nothing was hit.
 */
export function damageRows(dealt: readonly [string, number][], catalog: Pick<Catalog, 'weapons'>, top = 3): DamageRow[] {
  const total = dealt.reduce((sum, [, amount]) => sum + Math.max(0, amount), 0);
  if (total <= 0) return [];
  const named = dealt.filter(([id, amount]) => id && amount > 0 && catalog.weapons[id])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const rows: DamageRow[] = named.slice(0, top).map(([id, amount]) => ({
    id, name: catalog.weapons[id]!.name, sprite: catalog.weapons[id]!.sprite, amount, share: amount / total,
  }));
  const rest = total - rows.reduce((sum, row) => sum + row.amount, 0);
  if (rest > 0.5) rows.push({ id: '', name: OTHER, sprite: null, amount: rest, share: rest / total });
  return rows;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function speedLabel(percent: number): string {
  return `×${String(percent / 100).replace('.', ',')}`;
}

/** 1 забег, 2 забега, 5 забегов. */
export function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
}

type GoalProfile = Pick<Profile, 'caps' | 'emeralds' | 'runs_count' | 'achievements' | 'unlocks'
  | 'unlocked_locations' | 'unlocked_heroes' | 'open_items' | 'upgrades' | 'speeds' | 'wins' | 'milestones'
  | 'bosses_killed'>;

type GoalCatalog = Pick<Catalog, 'locations' | 'enemies' | 'heroes' | 'weapons' | 'passives' | 'upgrades'>;

/** How far a progress unlock is: lower is closer; null when it cannot be worked on now. */
function progressStep(unlock: ItemUnlock | HeroDefinition['unlock'], profile: GoalProfile,
  catalog: GoalCatalog): { distance: number; text: string } | null {
  const place = (id: string): string => catalog.locations[id]?.name ?? id;
  const open = (id: string): boolean => profile.unlocked_locations.includes(id);
  switch (unlock.type) {
    case 'runs': {
      const left = unlock.count - profile.runs_count;
      return left > 0 ? { distance: left, text: `Сыграйте ещё ${left} ${plural(left, 'забег', 'забега', 'забегов')}` } : null;
    }
    case 'achievements': {
      const left = unlock.count - profile.achievements.length;
      return left > 0 ? {
        distance: left + 1,
        text: `Получите ещё ${left} ${plural(left, 'достижение', 'достижения', 'достижений')}`,
      } : null;
    }
    case 'milestone':
      if (!open(unlock.location) || (profile.milestones[unlock.location] ?? []).some((mark) => mark >= unlock.atSecond)) {
        return null;
      }
      return { distance: 3, text: `Продержитесь ${clock(unlock.atSecond)} в локации «${place(unlock.location)}»` };
    case 'bossKilled':
      if (!open(unlock.location) || profile.bosses_killed.includes(unlock.location)) return null;
      return { distance: 4, text: `Победите босса в локации «${place(unlock.location)}»` };
    default:
      return null;
  }
}

/**
 * One concrete next goal in the shelter, by the plan's priority: the next location, then a hero
 * or item opened by progress, then a purchase the player can afford now, then a boss win at a
 * faster open speed. Only reads the profile, so it never offers something already done.
 */
export function nextGoal(profile: GoalProfile, catalog: GoalCatalog): string | null {
  for (const location of orderedLocations(catalog as Catalog)) {
    if (profile.unlocked_locations.includes(location.id) || location.unlock.type !== 'bossKilled') continue;
    const before = catalog.locations[location.unlock.location];
    if (!before || !profile.unlocked_locations.includes(before.id)) continue;
    const boss = catalog.enemies[before.boss.enemy]?.name ?? 'босса';
    return `Победите «${boss}» в локации «${before.name}», чтобы открыть «${location.name}».`;
  }

  const steps: { distance: number; text: string }[] = [];
  for (const hero of Object.values(catalog.heroes)) {
    if (profile.unlocked_heroes.includes(hero.id)) continue;
    const step = progressStep(hero.unlock, profile, catalog);
    if (step) steps.push({ distance: step.distance, text: `${step.text} — откроется герой «${hero.name}».` });
  }
  for (const [kind, items] of [['оружие', catalog.weapons], ['перк', catalog.passives]] as const) {
    for (const item of Object.values(items)) {
      if (profile.open_items.includes(item.id) || ('evolved' in item && item.evolved)) continue;
      const step = progressStep(item.unlock, profile, catalog);
      if (step) steps.push({ distance: step.distance, text: `${step.text} — откроется ${kind} «${item.name}».` });
    }
  }
  steps.sort((a, b) => a.distance - b.distance || a.text.localeCompare(b.text));
  if (steps[0]) return steps[0].text;

  const buys: { cost: number; caps: boolean; text: string }[] = [];
  for (const upgrade of Object.values(catalog.upgrades)) {
    const level = profile.upgrades[upgrade.id] ?? 0;
    if (level >= upgrade.maxLevel) continue;
    const cost = upgradeCost(upgrade, level);
    const caps = upgrade.currency === 'caps';
    if (cost > (caps ? profile.caps : profile.emeralds)) continue;
    buys.push({ cost, caps, text: caps
      ? `Хватает на «${upgrade.name}» за ${cost} крышек — вкладка «Улучшения».`
      : `Хватает на «${upgrade.name}» за ${cost} изумрудов — вкладка «За изумруды».` });
  }
  for (const item of [...Object.values(catalog.weapons), ...Object.values(catalog.passives)]) {
    if (item.unlock.type !== 'emeralds' || profile.unlocks.includes(item.id) || item.unlock.emeralds > profile.emeralds) continue;
    buys.push({ cost: item.unlock.emeralds, caps: false,
      text: `Хватает на «${item.name}» за ${item.unlock.emeralds} изумрудов — вкладка «За изумруды».` });
  }
  // Caps first: they are spent more often; then the cheapest.
  buys.sort((a, b) => Number(b.caps) - Number(a.caps) || a.cost - b.cost || a.text.localeCompare(b.text));
  if (buys[0]) return buys[0].text;

  for (const location of orderedLocations(catalog as Catalog)) {
    const best = Math.max(0, ...Object.values(profile.wins[location.id] ?? {}));
    if (!best) continue;
    const faster = (profile.speeds[location.id] ?? []).filter((speed) => speed > best).sort((a, b) => a - b)[0];
    if (faster) return `Победите босса в локации «${location.name}» на скорости ${speedLabel(faster)}.`;
  }
  return null;
}

/**
 * The evolution this run came closest to and what it lacked, e.g. the pistol at 8/8 without
 * its perk. Null when nothing was close or an evolution was taken.
 */
export function evolutionHint(build: RunBuild, catalog: Pick<Catalog, 'weapons' | 'passives'>): string | null {
  const owned = new Map(build.weapons);
  const perks = new Map(build.passives);
  let best: { gap: number; text: string } | null = null;
  for (const [id, level] of build.weapons) {
    const weapon = catalog.weapons[id];
    if (!weapon || weapon.evolutions.some((path) => owned.has(path.into))) continue;
    const max = weapon.levels.length;
    for (const path of weapon.evolutions) {
      const into = catalog.weapons[path.into]?.name ?? path.into;
      const perk = catalog.passives[path.passive]?.name ?? path.passive;
      const hasPerk = (perks.get(path.passive) ?? 0) > 0;
      // A missing perk counts as two levels: it needs a free slot and a lucky card.
      const gap = (max - level) + (hasPerk ? 0 : 2);
      if (gap === 0 || gap > 4) continue;
      const text = level >= max
        ? `Почти «${into}»: нужен перк «${perk}».`
        : hasPerk
          ? `Почти «${into}»: «${weapon.name}» ${level}/${max}.`
          : `Почти «${into}»: «${weapon.name}» ${level}/${max} и перк «${perk}».`;
      if (!best || gap < best.gap) best = { gap, text };
    }
  }
  return best?.text ?? null;
}

/** «Новый рекорд времени!» and the like; the first run on a location has no record yet. */
export function recordLines(record: RunRecord | null | undefined): string[] {
  if (!record) return [];
  if (record.previous_seconds === null || record.previous_kills === null) return ['Первая попытка здесь — рекорд записан.'];
  const lines: string[] = [];
  if (record.seconds > record.previous_seconds) lines.push('Новый рекорд времени!');
  if (record.kills > record.previous_kills) lines.push('Новый рекорд убийств!');
  if (!lines.length) {
    lines.push(`Рекорд здесь: ${clock(record.previous_seconds)}, ${record.previous_kills} ${
      plural(record.previous_kills, 'убийство', 'убийства', 'убийств')}.`);
  }
  return lines;
}

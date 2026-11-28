import { STAT_KEYS, type HeroDefinition, type StatKey, type WeaponLevel } from './schemas';

export const STAT_LABELS: Record<StatKey, string> = {
  maxHp: 'здоровье', armor: 'броня', regen: 'регенерация', moveSpeed: 'скорость',
  damage: 'урон', attackSpeed: 'скорость атаки', area: 'область', projectileCount: 'снаряды',
  duration: 'длительность', pickupRadius: 'радиус сбора', xpGain: 'опыт', luck: 'удача',
  radResist: 'защита от опасных зон', critChance: 'шанс крита', rerolls: 'переброс карточек',
  revives: 'возрождение', critDamage: 'урон крита', dodge: 'уклонение', thorns: 'урон шипов',
  headStart: 'уровень на старте', buffDuration: 'время усилений',
  landmarkSpeed: 'скорость взлома', autopilot: 'автопилот', weaponSlots: 'слот оружия', passiveSlots: 'слот перка',
  heavySlots: 'слот тяжёлого оружия',
  eliteDamage: 'урон боссам', killHeal: 'здоровье за убийство',
};

/** Stats stored as fractions and shown as percent. */
const FRACTIONS: ReadonlySet<StatKey> = new Set([
  'attackSpeed', 'area', 'duration', 'xpGain', 'luck', 'radResist', 'critChance',
  'critDamage', 'dodge', 'eliteDamage', 'buffDuration', 'landmarkSpeed',
]);

/** `+15% удача`; amounts are rounded so 3 × 0.05 does not show float noise. */
export function statBonus(stat: StatKey, amount: number, mod: 'flat' | 'percent' = 'flat'): string {
  const percent = mod === 'percent' || FRACTIONS.has(stat);
  const value = percent ? Math.round(amount * 1000) / 10 : Math.round(amount * 100) / 100;
  return `${value < 0 ? '' : '+'}${value}${percent ? '%' : ''} ${STAT_LABELS[stat]}`;
}

const LEVEL_FIELDS: readonly [keyof WeaponLevel, string, (value: number) => string][] = [
  ['damage', 'урон', String],
  ['cooldownMs', 'перезарядка', (value) => `${Math.round(value / 10) / 100}с`],
  ['shots', 'кол-во', String],
  ['pierce', 'пробой', String],
  ['jumps', 'скачки', String],
  ['radius', 'радиус', String],
  ['durationMs', 'время', (value) => `${Math.round(value / 100) / 10}с`],
];

/** What changes between two weapon levels, most important first. */
export function levelChanges(from: WeaponLevel, to: WeaponLevel, limit = 3): string[] {
  const lines: string[] = [];
  for (const [field, label, format] of LEVEL_FIELDS) {
    const before = from[field] ?? 0;
    const after = to[field] ?? 0;
    if (before !== after) lines.push(`${label} ${format(before)}>${format(after)}`);
  }
  return lines.slice(0, limit);
}

/** All numbers of one weapon level for a tooltip, e.g. `урон 9`. */
export function levelStats(level: WeaponLevel): string[] {
  return LEVEL_FIELDS.flatMap(([field, label, format]) => {
    const value = level[field];
    return value === undefined || (field === 'pierce' && !value) ? [] : [`${label} ${format(value)}`];
  });
}

/** How a hero differs from the basic one, strengths and weaknesses apart. */
export function heroTraits(hero: HeroDefinition, basic: HeroDefinition): { good: string[]; bad: string[] } {
  const good: string[] = [];
  const bad: string[] = [];
  for (const key of STAT_KEYS) {
    const difference = hero.baseStats[key] - basic.baseStats[key];
    if (difference) (difference > 0 ? good : bad).push(statBonus(key, difference));
  }
  return { good, bad };
}

/** Damage per second of one level, for comparing an evolution with its base weapon. */
function levelPower(level: WeaponLevel): number {
  return level.damage * level.shots / level.cooldownMs;
}

/**
 * What an evolution changes, for the evolution screen: the power ratio first (`сила ×2,1`),
 * then every changed number as `урон 20>24`.
 */
export function evolutionChanges(from: WeaponLevel, to: WeaponLevel): string[] {
  const ratio = Math.round(levelPower(to) / levelPower(from) * 10) / 10;
  return [`сила ×${String(ratio).replace('.', ',')}`, ...levelChanges(from, to, LEVEL_FIELDS.length)];
}

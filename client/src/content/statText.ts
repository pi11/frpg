import type { StatKey, WeaponLevel } from './schemas';

export const STAT_LABELS: Record<StatKey, string> = {
  maxHp: 'здоровье', armor: 'броня', regen: 'регенерация', moveSpeed: 'скорость',
  damage: 'урон', attackSpeed: 'скорость атаки', area: 'область', projectileCount: 'снаряды',
  duration: 'длительность', pickupRadius: 'радиус сбора', xpGain: 'опыт', luck: 'удача',
  radResist: 'защита от опасных зон', critChance: 'шанс крита', rerolls: 'переброс карточек',
  revives: 'возрождение',
};

/** Stats stored as fractions and shown as percent. */
const FRACTIONS: ReadonlySet<StatKey> = new Set([
  'attackSpeed', 'area', 'duration', 'xpGain', 'luck', 'radResist', 'critChance',
]);

/** `+15% удача`; amounts are rounded so 3 × 0.05 does not show float noise. */
export function statBonus(stat: StatKey, amount: number, mod: 'flat' | 'percent' = 'flat'): string {
  const percent = mod === 'percent' || FRACTIONS.has(stat);
  const value = Math.round((percent ? amount * 100 : amount) * 10) / 10;
  return `+${value}${percent ? '%' : ''} ${STAT_LABELS[stat]}`;
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

import { z } from 'zod';

export const STAT_KEYS = [
  'maxHp', 'armor', 'regen', 'moveSpeed', 'damage', 'attackSpeed', 'area',
  'projectileCount', 'duration', 'pickupRadius', 'xpGain', 'luck', 'radResist',
] as const;

export const StatKeySchema = z.enum(STAT_KEYS);
export type StatKey = z.infer<typeof StatKeySchema>;

export const StatsSchema = z.object({
  maxHp: z.number().nonnegative(),
  armor: z.number().nonnegative(),
  regen: z.number().nonnegative(),
  moveSpeed: z.number().positive(),
  damage: z.number(),
  attackSpeed: z.number(),
  area: z.number(),
  projectileCount: z.number().int().nonnegative(),
  duration: z.number().nonnegative(),
  pickupRadius: z.number().positive(),
  xpGain: z.number(),
  luck: z.number(),
  radResist: z.number(),
}).strict();
export type Stats = z.infer<typeof StatsSchema>;

const IdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
const spriteKey = (folder: string) => z.string().regex(
  new RegExp(`^${folder}/[a-z][a-z0-9_]*$`),
);
/** Audio keys map to client/public/assets/<key>.wav (sfx) or .ogg/.mp3 (music). */
const soundKey = (folder: 'sfx' | 'music') => spriteKey(folder);

export const HeroSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  sprite: spriteKey('heroes'),
  startingWeapon: IdSchema,
  unlock: z.object({ type: z.literal('default') }).strict(),
  baseStats: StatsSchema,
}).strict();
export type HeroDefinition = z.infer<typeof HeroSchema>;

export const WeaponLevelSchema = z.object({
  damage: z.number().positive(),
  cooldownMs: z.number().positive(),
  shots: z.number().int().positive(),
  spreadDegrees: z.number().nonnegative(),
}).strict();
export type WeaponLevel = z.infer<typeof WeaponLevelSchema>;

export const WeaponSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  sprite: spriteKey('weapons'),
  projectileSprite: spriteKey('projectiles'),
  fireSound: soundKey('sfx'),
  behavior: z.object({ type: IdSchema, params: z.unknown() }).strict(),
  levels: z.array(WeaponLevelSchema).length(8),
  tags: z.array(z.string()),
}).strict();
export type WeaponDefinition = z.infer<typeof WeaponSchema>;

export const PassiveSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  sprite: spriteKey('passives'),
  stat: StatKeySchema,
  mod: z.enum(['flat', 'percent']),
  perLevel: z.number(),
  maxLevel: z.number().int().positive(),
}).strict();
export type PassiveDefinition = z.infer<typeof PassiveSchema>;

export const EnemySchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  sprite: spriteKey('enemies'),
  ai: z.object({ type: IdSchema, params: z.unknown() }).strict(),
  stats: z.object({
    hp: z.number().positive(),
    speed: z.number().positive(),
    damage: z.number().nonnegative(),
    xp: z.number().int().nonnegative(),
  }).strict(),
  drops: z.array(z.object({
    item: z.literal('caps'),
    chance: z.number().min(0).max(1),
    amount: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  }).strict()),
  tags: z.array(z.string()),
}).strict();
export type EnemyDefinition = z.infer<typeof EnemySchema>;

export const LocationSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  groundSprite: spriteKey('ground'),
  music: soundKey('music'),
  durationSeconds: z.number().positive(),
  startingHero: IdSchema,
  waves: z.array(z.object({
    atSecond: z.number().nonnegative(),
    spawnIntervalMs: z.number().positive(),
    enemies: z.array(z.object({ id: IdSchema, weight: z.number().positive() }).strict()).min(1),
  }).strict()).min(1),
}).strict();
export type LocationDefinition = z.infer<typeof LocationSchema>;

export const UpgradeSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  stat: StatKeySchema,
  mod: z.enum(['flat', 'percent']),
  perLevel: z.number(),
  maxLevel: z.number().int().positive(),
  cost: z.object({ base: z.number().positive(), growth: z.number().positive() }).strict(),
}).strict();
export type UpgradeDefinition = z.infer<typeof UpgradeSchema>;

export const BalanceSchema = z.object({
  run: z.object({
    enemyLimit: z.number().int().positive(),
    projectileLimit: z.number().int().positive(),
    xpLimit: z.number().int().positive(),
    spawnDistance: z.number().positive(),
    despawnDistance: z.number().positive(),
    contactCooldownMs: z.number().positive(),
    magnetRadius: z.number().positive(),
    magnetSpeed: z.number().positive(),
  }).strict(),
  xp: z.object({ base: z.number().positive(), growth: z.number().positive() }).strict(),
  reward: z.object({
    base: z.number().nonnegative(),
    perSecond: z.number().nonnegative(),
    perKill: z.number().nonnegative(),
    perWave: z.number().nonnegative(),
    bossBonus: z.number().nonnegative(),
    maxKillsPerSecond: z.number().positive(),
    maxCapsPerSecond: z.number().positive(),
    durationGraceSeconds: z.number().nonnegative(),
  }).strict(),
}).strict();
export type BalanceDefinition = z.infer<typeof BalanceSchema>;

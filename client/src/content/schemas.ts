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

/**
 * One weapon level. `shots` is projectiles per volley, drones in orbit or bottles per throw;
 * `radius`, `durationMs` and `pierce` are used by behaviors that declare them as required.
 */
export const WeaponLevelSchema = z.object({
  damage: z.number().positive(),
  cooldownMs: z.number().positive(),
  shots: z.number().int().positive(),
  spreadDegrees: z.number().nonnegative(),
  radius: z.number().positive().optional(),
  durationMs: z.number().positive().optional(),
  pierce: z.number().int().nonnegative().optional(),
}).strict();
export type WeaponLevel = z.infer<typeof WeaponLevelSchema>;

export const WeaponSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  sprite: spriteKey('weapons'),
  projectileSprite: spriteKey('projectiles'),
  fireSound: soundKey('sfx'),
  behavior: z.object({ type: IdSchema, params: z.unknown() }).strict(),
  levels: z.array(WeaponLevelSchema).min(1).max(8),
  tags: z.array(z.string()),
  /** Base weapon at its last level + this passive owned → the `into` weapon is offered. */
  evolution: z.object({ passive: IdSchema, into: IdSchema }).strict().optional(),
  /** Evolved weapons have a single level and are never offered as new weapons. */
  evolved: z.boolean().default(false),
}).strict().superRefine((weapon, context) => {
  const expected = weapon.evolved ? 1 : 8;
  if (weapon.levels.length !== expected) {
    context.addIssue({ code: 'custom', path: ['levels'],
      message: `${weapon.evolved ? 'evolved' : 'base'} weapon needs ${expected} level(s)` });
  }
  if (weapon.evolved && weapon.evolution) {
    context.addIssue({ code: 'custom', path: ['evolution'], message: 'evolved weapon cannot evolve again' });
  }
});
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
  /** normal enemies come from waves; elites (mini-bosses) and the boss from timed events. */
  role: z.enum(['normal', 'elite', 'boss']),
  ai: z.object({ type: IdSchema, params: z.unknown() }).strict(),
  stats: z.object({
    hp: z.number().positive(),
    speed: z.number().nonnegative(),
    damage: z.number().nonnegative(),
    xp: z.number().int().nonnegative(),
  }).strict(),
  drops: z.array(z.discriminatedUnion('item', [
    z.object({
      item: z.literal('caps'),
      chance: z.number().min(0).max(1),
      amount: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
    }).strict(),
    z.object({
      item: z.literal('pickup'),
      id: IdSchema,
      chance: z.number().min(0).max(1),
    }).strict(),
  ])),
  /** On death it breaks into `count` smaller enemies (role normal). */
  split: z.object({ enemy: IdSchema, count: z.number().int().positive() }).strict().optional(),
  tags: z.array(z.string()),
}).strict();
export type EnemyDefinition = z.infer<typeof EnemySchema>;

const RangeSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);
const WeightedSpritesSchema = z.object({
  perChunk: RangeSchema,
  items: z.array(z.object({ sprite: spriteKey('decor'), weight: z.number().positive() }).strict()).min(1),
}).strict();

export const PickupSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  sprite: spriteKey('pickups'),
  sound: soundKey('sfx'),
  /** Caps and XP-like pickups fly to the hero inside the magnet radius; others must be touched. */
  attract: z.boolean(),
  effect: z.object({ type: IdSchema, params: z.unknown() }).strict(),
}).strict();
export type PickupDefinition = z.infer<typeof PickupSchema>;

export const LocationSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  /** Open from the start, or after the boss of another location was killed once. */
  unlock: z.discriminatedUnion('type', [
    z.object({ type: z.literal('default') }).strict(),
    z.object({ type: z.literal('bossKilled'), location: IdSchema }).strict(),
  ]),
  /** Multiplies the earned reward (not the picked-up caps); checked by the server. */
  rewardMultiplier: z.number().positive(),
  groundSprite: spriteKey('ground'),
  music: soundKey('music'),
  durationSeconds: z.number().positive(),
  startingHero: IdSchema,
  waves: z.array(z.object({
    atSecond: z.number().nonnegative(),
    spawnIntervalMs: z.number().positive(),
    /** Multiplies the HP of enemies spawned during this wave. */
    hpMultiplier: z.number().positive(),
    /** Multiplies the speed of enemies spawned during this wave. */
    speedMultiplier: z.number().positive(),
    enemies: z.array(z.object({
      id: IdSchema,
      weight: z.number().positive(),
      /** How many arrive together as a pack (1 = alone). */
      group: z.number().int().positive().default(1),
    }).strict()).min(1),
  }).strict()).min(1),
  /** Mini-bosses at fixed times; they appear with a warning and drop their loot. */
  events: z.array(z.object({
    atSecond: z.number().nonnegative(),
    enemy: IdSchema,
    count: z.number().int().positive(),
  }).strict()),
  /** Killing the boss wins the run; the server checks the time and grants the boss bonus. */
  boss: z.object({ atSecond: z.number().positive(), enemy: IdSchema }).strict(),
  bossMusic: soundKey('music'),
  decor: z.object({
    chunkSize: z.number().int().positive(),
    patches: WeightedSpritesSchema,
    objects: WeightedSpritesSchema,
    crates: z.object({
      sprite: spriteKey('decor'),
      hp: z.number().positive(),
      perChunk: RangeSchema,
      drops: z.array(z.object({ pickup: IdSchema, weight: z.number().positive() }).strict()).min(1),
    }).strict(),
  }).strict(),
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
    /** Loot within this distance of the hero is collected; the pickupRadius stat sets how far it flies in from. */
    collectRadius: z.number().positive(),
    magnetSpeed: z.number().positive(),
    enemyProjectileLimit: z.number().int().positive(),
    pickupLimit: z.number().int().positive(),
    zoneLimit: z.number().int().positive(),
    crateLimit: z.number().int().positive(),
    /** Seconds of the warning banner before a mini-boss or the boss appears. */
    eliteWarningSeconds: z.number().nonnegative(),
    /** Aimed weapons shoot an elite or boss inside this range before the nearest enemy. */
    eliteFocusRange: z.number().nonnegative(),
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

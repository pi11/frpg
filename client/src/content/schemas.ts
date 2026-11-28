import { z } from 'zod';

export const STAT_KEYS = [
  'maxHp', 'armor', 'regen', 'moveSpeed', 'damage', 'attackSpeed', 'area',
  'projectileCount', 'duration', 'pickupRadius', 'xpGain', 'luck', 'radResist',
  'critChance', 'critDamage', 'dodge', 'thorns', 'eliteDamage', 'killHeal', 'rerolls', 'revives',
  'weaponSlots', 'passiveSlots', 'heavySlots', 'autopilot', 'headStart', 'buffDuration', 'landmarkSpeed',
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
  critChance: z.number().min(0).max(1),
  /** Added to balance.run.critMultiplier. */
  critDamage: z.number().nonnegative(),
  dodge: z.number().min(0).max(1),
  /** Damage dealt back to an enemy that hits the hero by contact. */
  thorns: z.number().nonnegative(),
  /** Extra damage share against elites and bosses. */
  eliteDamage: z.number().nonnegative(),
  /** HP restored per kill. */
  killHeal: z.number().nonnegative(),
  /** Level-up rerolls and extra lives per run. */
  rerolls: z.number().int().nonnegative(),
  revives: z.number().int().nonnegative(),
  /** Slots for ordinary weapons and perks, up to balance.run.maxWeapons / maxPassives. */
  weaponSlots: z.number().int().positive(),
  passiveSlots: z.number().int().positive(),
  /** Heavy weapon slots, bought for emeralds, up to balance.run.maxHeavyWeapons. */
  heavySlots: z.number().int().nonnegative(),
  /** 1 when the autopilot was bought. */
  autopilot: z.number().int().min(0).max(1),
  /** Level-ups at the start of a run. */
  headStart: z.number().int().nonnegative(),
  /** Longer temporary bonuses and faster landmarks, shares. */
  buffDuration: z.number().nonnegative(),
  landmarkSpeed: z.number().nonnegative(),
}).strict();
export type Stats = z.infer<typeof StatsSchema>;

const IdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
const spriteKey = (folder: string) => z.string().regex(
  new RegExp(`^${folder}/[a-z][a-z0-9_]*$`),
);
/** Audio keys map to client/public/assets/<key>.wav (sfx) or .ogg/.mp3 (music). */
const soundKey = (folder: 'sfx' | 'music') => spriteKey(folder);

/** Conditions met by playing; checked by hero_progress in economy.py and progressMet on the client. */
const PROGRESS_UNLOCKS = [
  z.object({ type: z.literal('runs'), count: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('achievements'), count: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('bossKilled'), location: IdSchema }).strict(),
  z.object({ type: z.literal('milestone'), location: IdSchema,
    atSecond: z.number().int().positive() }).strict(),
] as const;

export const HeroSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  sprite: spriteKey('heroes'),
  startingWeapon: IdSchema,
  /** Checked by the server (unlocked_heroes in economy.py). */
  unlock: z.discriminatedUnion('type', [
    z.object({ type: z.literal('default') }).strict(), ...PROGRESS_UNLOCKS,
  ]),
  baseStats: StatsSchema,
}).strict();
export type HeroDefinition = z.infer<typeof HeroSchema>;

/** Weapons and perks are offered in runs at once, after progress, or after being bought for emeralds. */
const ItemUnlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('default') }).strict(),
  z.object({ type: z.literal('emeralds'), emeralds: z.number().int().positive() }).strict(),
  ...PROGRESS_UNLOCKS,
]).default({ type: 'default' });
export type ItemUnlock = z.infer<typeof ItemUnlockSchema>;
export type ProgressUnlock = Exclude<ItemUnlock, { type: 'default' | 'emeralds' }>;

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
  /** Extra enemies a lightning bolt jumps to. */
  jumps: z.number().int().nonnegative().optional(),
}).strict();
export type WeaponLevel = z.infer<typeof WeaponLevelSchema>;

export const WeaponSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  sprite: spriteKey('weapons'),
  projectileSprite: spriteKey('projectiles'),
  fireSound: soundKey('sfx'),
  /** Colour of the aura or lightning (#rrggbb); evolved weapons have their own. */
  color: z.string().regex(/^#[0-9a-f]{6}$/).optional(),
  behavior: z.object({ type: IdSchema, params: z.unknown() }).strict(),
  levels: z.array(WeaponLevelSchema).min(1).max(8),
  tags: z.array(z.string()),
  /** Base weapon at its last level + one of these passives owned → its `into` weapon is offered. */
  evolutions: z.array(z.object({ passive: IdSchema, into: IdSchema }).strict()).default([]),
  /** Evolved weapons have a single level and are never offered as new weapons. */
  evolved: z.boolean().default(false),
  /** Heavy weapons use their own slots, have 5 levels and do not evolve. */
  heavy: z.boolean().default(false),
  /** Offered as a new weapon only from this hero level. */
  minHeroLevel: z.number().int().positive().default(1),
  unlock: ItemUnlockSchema,
}).strict().superRefine((weapon, context) => {
  const expected = weapon.evolved ? 1 : weapon.heavy ? 5 : 8;
  if (weapon.levels.length !== expected) {
    context.addIssue({ code: 'custom', path: ['levels'],
      message: `${weapon.evolved ? 'evolved' : weapon.heavy ? 'heavy' : 'base'} weapon needs ${expected} level(s)` });
  }
  if ((weapon.evolved || weapon.heavy) && weapon.evolutions.length) {
    context.addIssue({ code: 'custom', path: ['evolutions'], message: 'evolved and heavy weapons cannot evolve' });
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
  unlock: ItemUnlockSchema,
}).strict();
export type PassiveDefinition = z.infer<typeof PassiveSchema>;

export const EnemySchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  sprite: spriteKey('enemies'),
  /** normal enemies come from waves; elites (mini-bosses) and the boss from timed events. */
  role: z.enum(['normal', 'elite', 'boss']),
  /** Sprite and body size multiplier. */
  scale: z.number().positive().default(1),
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

/**
 * A place on the map with a one-time reward. The hero stands inside `radius` for `holdMs`
 * (and pays `caps` collected in this run); an ambush comes from the current wave.
 */
/**
 * One card of a landmark's choice. `caps` is paid once when it is chosen; `holdMs` 0 gives the
 * reward at once. The rewards roll from the landmark's own list; `guaranteed` pickups come on top.
 */
export const LandmarkChoiceSchema = z.object({
  id: z.enum(['careful', 'risky', 'buy']),
  title: z.string().min(1),
  description: z.string().min(1),
  caps: z.number().int().nonnegative(),
  holdMs: z.number().nonnegative(),
  rolls: RangeSchema,
  guaranteed: z.array(IdSchema).default([]),
  /** Enemies from the current wave: right after the choice, or when the reward is given. */
  ambush: z.object({ count: z.number().int().positive(), when: z.enum(['choose', 'complete']) }).strict().optional(),
}).strict();
export type LandmarkChoice = z.infer<typeof LandmarkChoiceSchema>;

export const LandmarkSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  hint: z.string().min(1),
  /** The atlas also needs `<sprite>_used`. */
  sprite: spriteKey('landmarks'),
  trigger: z.object({
    radius: z.number().positive(),
    holdMs: z.number().positive(),
    caps: z.number().int().nonnegative(),
  }).strict(),
  rolls: RangeSchema,
  rewards: z.array(z.object({ pickup: IdSchema, weight: z.number().positive() }).strict()).min(1),
  ambush: z.object({ count: z.number().int().positive() }).strict().optional(),
  /**
   * Optional cards shown when the hero first steps in; they replace trigger.holdMs/caps, rolls
   * and ambush for this place. Without them the landmark works as before.
   */
  choices: z.array(LandmarkChoiceSchema).min(2).max(3).optional(),
}).strict();
export type LandmarkDefinition = z.infer<typeof LandmarkSchema>;

const offset = { x: z.number().int(), y: z.number().int() };
/** A hand-made group of decor, crates and landmarks around its centre. */
export const StructureSchema = z.object({
  id: IdSchema,
  items: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('patch'), sprite: spriteKey('decor'), ...offset }).strict(),
    z.object({ kind: z.literal('object'), sprite: spriteKey('decor'), ...offset }).strict(),
    z.object({ kind: z.literal('crate'), ...offset }).strict(),
    z.object({ kind: z.literal('landmark'), landmark: IdSchema, ...offset }).strict(),
  ])).min(1),
}).strict();
export type StructureDefinition = z.infer<typeof StructureSchema>;

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
  /** Emeralds per mini-boss, per boss, and extra for the first boss kill; granted by the server. */
  emeralds: z.object({
    elite: z.number().int().nonnegative(),
    boss: z.number().int().nonnegative(),
    firstBoss: z.number().int().nonnegative(),
  }).strict(),
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
    /** A region of biomeChunks × biomeChunks chunks shares one biome. */
    biomeChunks: z.number().int().positive(),
    biomes: z.array(z.object({
      id: IdSchema,
      weight: z.number().positive(),
      patches: WeightedSpritesSchema,
      objects: WeightedSpritesSchema,
    }).strict()).min(1),
    structures: z.object({
      /** Chance of a structure in a chunk. */
      chance: z.number().min(0).max(1),
      items: z.array(z.object({ structure: IdSchema, weight: z.number().positive() }).strict()).min(1),
    }).strict(),
    /** Patches that hurt (reduced by radResist) or slow the hero. */
    hazards: z.array(z.object({
      sprite: spriteKey('decor'),
      radius: z.number().positive(),
      damagePerSecond: z.number().nonnegative(),
      slow: z.number().min(0).max(0.9),
    }).strict()),
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
  category: z.enum(['slots', 'special', 'survival', 'combat', 'scavenge']),
  currency: z.enum(['caps', 'emeralds']).default('caps'),
  stat: StatKeySchema,
  mod: z.enum(['flat', 'percent']),
  perLevel: z.number(),
  maxLevel: z.number().int().positive(),
  cost: z.object({ base: z.number().positive(), growth: z.number().positive() }).strict(),
}).strict();
export type UpgradeDefinition = z.infer<typeof UpgradeSchema>;

/**
 * `metric` conditions are computed by the server (server/app/services/achievements.py).
 * `reported` events are noticed by the client (systems/achievements.ts); the server only checks
 * minSeconds, boss, autopilot and minSpeed. `victory` reads the boss wins per location, hero and
 * game speed kept by the server.
 */
export const AchievementSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  /** Not listed until earned. */
  hidden: z.boolean(),
  emeralds: z.number().int().positive(),
  condition: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('metric'),
      metric: z.enum(['kills', 'duration', 'caps', 'boss', 'runs', 'unlocks']),
      value: z.number().int().positive(),
      location: IdSchema.optional(),
      /** Only in a run at this game speed (percent) or faster. */
      minSpeed: z.number().int().min(100).optional(),
    }).strict(),
    z.object({
      type: z.literal('reported'),
      event: z.enum(['noMove', 'finishNoMove', 'noDamage', 'singleWeapon', 'evolved', 'bossFast',
        'knocks', 'lowHp', 'exactKills', 'crates', 'frozen', 'flips', 'autoPicks', 'noKills',
        'alwaysMoving', 'landmarks', 'broke', 'bossIgnored', 'flawless', 'bossOneGun', 'noPerks',
        'noUpgrades', 'bossLowHp', 'evolutions', 'heroClicks', 'earlyDeath', 'earlyQuit', 'autopilotTime', 'pauses', 'hazardTime', 'nightHour',
        'boosts', 'risks', 'declines']),
      value: z.number().int().positive(),
      minSeconds: z.number().int().nonnegative().default(0),
      boss: z.boolean().default(false),
      autopilot: z.boolean().default(false),
      minSpeed: z.number().int().min(100).default(100),
      /** Only in a run at this location. */
      location: IdSchema.optional(),
      /** Only in a run that took at least this many emerald boosts (checked by the server too). */
      minBoosts: z.number().int().positive().optional(),
    }).strict(),
    z.object({
      /** Granted by the server at sign-in: by mail, through Telegram or with the account key. */
      type: z.literal('account'),
      event: z.enum(['email', 'telegram', 'key']),
    }).strict(),
    z.object({
      type: z.literal('victory'),
      /** Boss beaten at this game speed (percent) or faster. */
      speed: z.number().int().min(100),
      /** Empty: any location (or hero). */
      locations: z.array(IdSchema),
      heroes: z.array(IdSchema),
      /** Every location × hero pair, not just one. */
      every: z.boolean(),
    }).strict(),
  ]),
}).strict();
export type AchievementDefinition = z.infer<typeof AchievementSchema>;

/**
 * A one-run boost bought for emeralds in the shelter. It waits in the profile and is used up
 * when the next run starts (server/app/api/runs.py), whatever happens in that run.
 */
export const BoostSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  sprite: spriteKey('boosts'),
  emeralds: z.number().int().positive(),
  /** Added to the hero's stats for the run, like shelter upgrades. */
  effects: z.array(z.object({
    stat: StatKeySchema,
    mod: z.enum(['flat', 'percent']),
    value: z.number(),
  }).strict()),
  /** Extra share of the earned caps (not the picked-up ones); the server applies it. */
  rewardBonus: z.number().positive().max(2).optional(),
}).strict().refine((item) => item.effects.length > 0 || item.rewardBonus !== undefined,
  'a boost needs effects or rewardBonus');
export type BoostDefinition = z.infer<typeof BoostSchema>;

/** A daily quest template; the server picks 3-4 per day (server/app/services/daily.py). */
export const DailyTemplateSchema = z.object({
  id: IdSchema,
  /** `{goal}` is replaced by the amount (minutes for `survive`). */
  text: z.string().min(1),
  metric: z.enum(['kills', 'enemyKills', 'survive', 'runs', 'elites', 'caps', 'boss']),
  goals: z.array(z.number().int().positive()).min(1),
  emeralds: z.array(z.number().int().positive()).min(1),
  weight: z.number().positive(),
  enemy: IdSchema.optional(),
}).strict().refine((item) => item.goals.length === item.emeralds.length,
  'goals and emeralds need the same length')
  .refine((item) => (item.metric === 'enemyKills') === Boolean(item.enemy), 'enemy goes with enemyKills');
export type DailyTemplateDefinition = z.infer<typeof DailyTemplateSchema>;

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
    /** Upper limit of the weaponSlots and passiveSlots stats. */
    maxWeapons: z.number().int().positive(),
    maxPassives: z.number().int().positive(),
    maxHeavyWeapons: z.number().int().positive(),
    /** Global difficulty: enemy HP and every hit an enemy deals to the hero are multiplied by these. */
    enemyHpMultiplier: z.number().positive(),
    enemyDamageMultiplier: z.number().positive(),
    /** Hero speed above softMoveSpeed counts only by the factor. */
    softMoveSpeed: z.number().positive(),
    softMoveSpeedFactor: z.number().min(0).max(1),
    /** Share of max HP a mini-boss or boss can lose per second, so strong builds still get a fight. */
    eliteMaxLossPerSecond: z.number().gt(0).max(1),
    bossMaxLossPerSecond: z.number().gt(0).max(1),
    /** A random card is taken when the player does not choose in time. */
    /** Pace of every run before the chosen speed: 0.8 makes ×1 a calmer game. */
    timeScale: z.number().positive().max(1),
    levelUpTimeoutMs: z.number().positive(),
    maxDodge: z.number().min(0).max(1),
    critMultiplier: z.number().min(1),
    reviveHpFraction: z.number().gt(0).max(1),
    reviveInvulnerableMs: z.number().nonnegative(),
    reviveBlastRadius: z.number().positive(),
    reviveBlastDamage: z.number().positive(),
    hazardTickMs: z.number().positive(),
    /** How fast landmark progress is lost outside its circle (1 = as fast as it grows). */
    landmarkDecayRate: z.number().nonnegative(),
    /** Off-screen landmarks closer than this get an arrow at the screen edge. */
    landmarkHintRange: z.number().nonnegative(),
  }).strict(),
  daily: z.object({
    minQuests: z.number().int().positive(),
    maxQuests: z.number().int().positive(),
    /** Quests change at midnight of this time zone. */
    utcOffsetHours: z.number().int().min(-12).max(14),
    /** Shorter runs do not count for the `runs` quest. */
    minRunSeconds: z.number().int().nonnegative(),
  }).strict(),
  /** Game speeds in percent; each next one opens after a boss win at the previous one. */
  speeds: z.array(z.object({
    percent: z.number().int().min(100),
    /** Once per location, for the first boss win at this speed. */
    firstWinEmeralds: z.number().int().nonnegative(),
  }).strict()).min(1),
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
    /** Emeralds for surviving this long, once per location. */
    emeraldMilestones: z.array(z.object({
      atSecond: z.number().int().positive(),
      amount: z.number().int().positive(),
    }).strict()),
  }).strict(),
}).strict();
export type BalanceDefinition = z.infer<typeof BalanceSchema>;

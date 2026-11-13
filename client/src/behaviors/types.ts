import type { z } from 'zod';
import type { StatKey, WeaponDefinition, WeaponLevel } from '../content/schemas';

/**
 * Behaviors only see these small interfaces, never Phaser objects, so every behavior
 * can be unit-tested with plain fakes. RunScene adapts sprites to them.
 */
export interface Point {
  x: number;
  y: number;
}

/** Enemy as seen by an AI behavior. */
export interface Mob extends Point {
  readonly velocityX: number;
  readonly velocityY: number;
  /** stats.speed from content. */
  readonly speed: number;
  /** Current HP divided by spawn HP, 0..1. */
  readonly hpFraction: number;
  setVelocity(x: number, y: number): void;
  /** Per-enemy scratch numbers; every key reads as 0 after spawn. */
  readonly memory: Record<string, number>;
  /** Visual warning before a charge or explosion. */
  telegraph(on: boolean): void;
  /** Underground: untargetable, no contact damage, drawn as a faint mound. */
  setBurrowed(on: boolean): void;
}

export interface EnemyContext {
  readonly hero: Point;
  /** Run time in ms (pauses excluded); RunScene updates it every frame. */
  now: number;
  shoot(from: Point, vx: number, vy: number, damage: number, sprite: string, lifetimeMs: number): void;
  /** Blow the mob up: damages the hero inside `radius` and removes the mob without loot. */
  explode(mob: Mob, radius: number, damage: number): void;
  summon(enemyId: string, count: number, around: Point): void;
  /** Ground burst at `center`: damages the hero inside `radius`. */
  shockwave(center: Point, radius: number, damage: number): void;
  /** Heals other ordinary (not elite or boss) enemies inside `radius` by `fraction` of their max HP. */
  healAround(healer: Mob, radius: number, fraction: number): number;
}

export interface EnemyBehavior<P> {
  readonly paramsSchema: z.ZodType<P>;
  update(mob: Mob, context: EnemyContext, params: P, deltaMs: number): void;
  /** Extra checks after the schema, e.g. nested behaviors of a boss. */
  validate?(params: P): void;
}

export interface ProjectileSpec {
  vx: number;
  vy: number;
  damage: number;
  lifetimeMs: number;
  sprite: string;
  pierce: number;
}

export interface ZoneSpec extends Point {
  radius: number;
  damage: number;
  tickMs: number;
  durationMs: number;
  sprite: string;
}

export interface HitLimit {
  /** One hit per enemy per `cooldownMs` for this owner (e.g. a drone weapon). */
  owner: string;
  cooldownMs: number;
}

export interface CombatContext {
  readonly hero: Point;
  now: number;
  rng(): number;
  stat(key: StatKey): number;
  nearestEnemy(): Point | null;
  randomEnemyWithin(range: number): Point | null;
  /** Damage every enemy (and crate) inside the circle; returns how many were hit. */
  damageInRadius(center: Point, radius: number, damage: number, limit?: HitLimit): number;
  spawnProjectile(spec: ProjectileSpec): void;
  spawnZone(spec: ZoneSpec): void;
  /** Show one orbiting sprite per position for this owner; an empty list hides them. */
  placeOrbiters(owner: string, sprite: string, positions: readonly Point[]): void;
  /** Draw (radius > 0) or hide (0) an aura ring around the hero. */
  showAura(owner: string, radius: number): void;
}

export interface WeaponState {
  level: number;
  clock: number;
  activeUntil: number;
  angle: number;
}

/** 'fired' plays the weapon sound, 'silent' consumes the cooldown quietly, 'skip' waits. */
export type FireResult = 'fired' | 'silent' | 'skip';

export type LevelField = 'radius' | 'durationMs' | 'pierce';

export interface WeaponBehavior<P> {
  readonly paramsSchema: z.ZodType<P>;
  /** Level fields this behavior needs in every level of the weapon JSON. */
  readonly requiredLevelFields: readonly LevelField[];
  fire(context: CombatContext, weapon: WeaponDefinition, level: WeaponLevel, params: P,
    state: WeaponState): FireResult;
  update?(context: CombatContext, weapon: WeaponDefinition, level: WeaponLevel, params: P,
    state: WeaponState, deltaMs: number): void;
}

export interface PickupContext {
  rng(): number;
  /** Luck stat; effects may scale with it. */
  luck(): number;
  readonly hero: Point;
  heal(fraction: number): void;
  attractAll(): void;
  blast(center: Point, radius: number, damage: number): void;
  addCaps(amount: number): void;
  openChest(items: number, caps: number): void;
}

export interface PickupEffect<P> {
  readonly paramsSchema: z.ZodType<P>;
  apply(context: PickupContext, params: P): void;
}

/** Inclusive integer in [min, max] from a 0..1 random value. */
export function rollRange(range: readonly [number, number], random: number): number {
  const [min, max] = range;
  return min + Math.floor(random * (max - min + 1));
}

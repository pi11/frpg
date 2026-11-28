import type { Point } from '../behaviors/types';
import type { LocationDefinition, SpecialRule } from '../content/schemas';
import { structureAt } from './WorldDecor';

/**
 * Distinctive location rules: the toxic fog of the marsh and the defence turrets of the
 * military base. Everything runs on game time handed in by RunScene (pause and speed act on it
 * like on waves) and on the run seed; the scene only draws and connects it.
 */

type Decor = LocationDefinition['decor'];
export type FogRule = Extract<SpecialRule, { type: 'toxicFog' }>;
export type TurretRule = Extract<SpecialRule, { type: 'turrets' }>;

/** How far around the hero (in chunks) safe zones and turrets are looked for. */
export const RULE_SEARCH_CHUNKS = 3;

export type FogPhase =
  | { state: 'clear' }
  | { state: 'warning'; secondsLeft: number }
  | { state: 'fog'; secondsLeft: number };

/** Fog at `first + n × every` for `duration` seconds, with a warning `warning` seconds before. */
export function fogPhase(rule: FogRule, seconds: number): FogPhase {
  const { firstAtSecond: first, everySeconds: every, durationSeconds: duration, warningSeconds: warning } = rule;
  let next = first;
  if (seconds >= first) {
    const start = first + Math.floor((seconds - first) / every) * every;
    if (seconds < start + duration) return { state: 'fog', secondsLeft: start + duration - seconds };
    next = start + every;
  }
  return next - seconds <= warning ? { state: 'warning', secondsLeft: next - seconds } : { state: 'clear' };
}

/** Centres of the listed structures in the chunks around `center`, cached per chunk. */
export class StructureFinder {
  private readonly cache = new Map<string, (Point & { id: string }) | null>();

  constructor(private readonly seed: number, private readonly decor: Decor, private readonly ids: readonly string[]) {}

  around(center: Point, chunks = RULE_SEARCH_CHUNKS): (Point & { key: string; id: string })[] {
    const size = this.decor.chunkSize;
    const cx = Math.floor(center.x / size);
    const cy = Math.floor(center.y / size);
    const found: (Point & { key: string; id: string })[] = [];
    for (let dy = -chunks; dy <= chunks; dy += 1) {
      for (let dx = -chunks; dx <= chunks; dx += 1) {
        const key = `${cx + dx},${cy + dy}`;
        let point = this.cache.get(key);
        if (point === undefined) {
          const structure = structureAt(this.seed, cx + dx, cy + dy, this.decor);
          point = structure && this.ids.includes(structure.id) ? structure : null;
          this.cache.set(key, point);
        }
        if (point) found.push({ ...point, key });
      }
    }
    return found;
  }
}

export function nearest<T extends Point>(points: readonly T[], from: Point): T | null {
  let best: T | null = null;
  let distance = Infinity;
  for (const point of points) {
    const current = Math.hypot(point.x - from.x, point.y - from.y);
    if (current < distance) {
      distance = current;
      best = point;
    }
  }
  return best;
}

export function insideAny(points: readonly Point[], from: Point, radius: number): boolean {
  return points.some((point) => Math.hypot(point.x - from.x, point.y - from.y) <= radius);
}

/**
 * Damage of one hazard tick: ground hazards and fog add up, radResist reduces both, and the
 * total never goes above `cap` (balance.run.maxHazardDamagePerTick).
 */
export function hazardTickDamage(hazardDps: number, fogDps: number, resist: number, tickMs: number, cap: number): number {
  const share = 1 - Math.min(1, Math.max(0, resist));
  return Math.min(cap, (hazardDps + fogDps) * share * tickMs / 1000);
}

export interface TurretPost extends Point {
  readonly key: string;
  state: 'idle' | 'active' | 'spent';
  /** 0..1 of the switch-on hold. */
  progress: number;
  /** Game ms when an active turret stops. */
  until: number;
  shootAt: number;
}

export interface TurretHooks {
  /** Nearest ordinary enemy within range: turrets never aim at mini-bosses or the boss. */
  target(from: Point, range: number): Point | null;
  shoot(from: Point, target: Point): void;
}

/**
 * Turrets of the military base. Each one is switched on once by standing next to it with
 * enough run caps (paid at switch-on), fires for a while and then stays spent for the run.
 */
export class TurretField {
  readonly posts = new Map<string, TurretPost>();
  private readonly finder: StructureFinder;

  constructor(private readonly rule: TurretRule, seed: number, decor: Decor) {
    this.finder = new StructureFinder(seed, decor, rule.structures.map((item) => item.structure));
  }

  get active(): number {
    let count = 0;
    for (const post of this.posts.values()) if (post.state === 'active') count += 1;
    return count;
  }

  /** Adds posts that came into reach; a post keeps its state for the whole run. */
  sync(center: Point): void {
    for (const point of this.finder.around(center)) {
      if (this.posts.has(point.key)) continue;
      const offset = this.rule.structures.find((item) => item.structure === point.id)!;
      this.posts.set(point.key, {
        key: point.key, x: point.x + offset.x, y: point.y + offset.y, state: 'idle', progress: 0, until: 0, shootAt: 0,
      });
    }
  }

  /**
   * One step at game time `now`. Returns the caps paid this step (0 or the price of one turret)
   * so the scene takes them once.
   */
  update(now: number, delta: number, hero: Point, caps: number, hooks: TurretHooks): number {
    const { rule } = this;
    let paid = 0;
    for (const post of this.posts.values()) {
      if (post.state === 'active') {
        if (now >= post.until) {
          post.state = 'spent';
          continue;
        }
        if (now < post.shootAt) continue;
        const target = hooks.target(post, rule.range);
        if (!target) continue;
        post.shootAt = now + rule.shotIntervalMs;
        hooks.shoot(post, target);
        continue;
      }
      if (post.state !== 'idle') continue;
      const near = Math.hypot(post.x - hero.x, post.y - hero.y) <= rule.radius;
      const allowed = caps - paid >= rule.caps && this.active < rule.maxActive;
      post.progress = near && allowed ? post.progress + delta / rule.holdMs : 0;
      if (post.progress < 1) continue;
      post.state = 'active';
      post.progress = 1;
      post.until = now + rule.durationSeconds * 1000;
      post.shootAt = now;
      paid += rule.caps;
    }
    return paid;
  }

  /** Why the turret next to the hero cannot start, for the prompt; null when it can. */
  blocker(caps: number): string | null {
    if (caps < this.rule.caps) return `нужно ${this.rule.caps} крышек`;
    if (this.active >= this.rule.maxActive) return `уже работают ${this.rule.maxActive}`;
    return null;
  }
}

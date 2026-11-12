import { describe, expect, it } from 'vitest';
import { getCatalog } from '../content/catalog';
import type { WeaponDefinition, WeaponLevel } from '../content/schemas';
import { generateChunk } from '../systems/WorldDecor';
import { enemyBehaviors, pickupEffects, weaponBehaviors } from './registry';
import type {
  CombatContext, EnemyContext, Mob, PickupContext, Point, ProjectileSpec, WeaponState, ZoneSpec,
} from './types';

function mob(x: number, y: number, speed = 50, hpFraction = 1): Mob & { telegraphs: boolean[]; hpFraction: number } {
  const state = {
    x, y, velocityX: 0, velocityY: 0, speed, hpFraction, memory: {} as Record<string, number>,
    telegraphs: [] as boolean[],
    setVelocity(vx: number, vy: number) { state.velocityX = vx; state.velocityY = vy; },
    telegraph(on: boolean) { state.telegraphs.push(on); },
  };
  return state;
}

function enemyContext(hero: Point, now = 0) {
  const log = {
    shots: [] as { vx: number; vy: number; damage: number }[],
    explosions: [] as { radius: number; damage: number }[],
    summons: [] as { id: string; count: number }[],
  };
  const context: EnemyContext & { now: number } = {
    hero, now,
    shoot: (_from, vx, vy, damage) => { log.shots.push({ vx, vy, damage }); },
    explode: (_mob, radius, damage) => { log.explosions.push({ radius, damage }); },
    summon: (id, count) => { log.summons.push({ id, count }); },
  };
  return { context, log };
}

const enemy = (type: string) => enemyBehaviors[type]!;

describe('enemy behaviors', () => {
  it('chaser steers towards the hero', () => {
    const target = mob(0, 0, 60);
    enemy('chaser').update(target, enemyContext({ x: 100, y: 0 }).context, { turnRate: 100 }, 1000);
    expect(target.velocityX).toBeCloseTo(60);
    expect(target.velocityY).toBeCloseTo(0);
  });

  it('charger winds up, dashes in a fixed direction, then cools down', () => {
    const params = { turnRate: 10, chargeRange: 100, windupMs: 500, chargeSpeed: 200, chargeMs: 300, cooldownMs: 1000 };
    const target = mob(0, 0);
    const { context } = enemyContext({ x: 50, y: 0 });
    enemy('charger').update(target, context, params, 16);
    expect(target.telegraphs).toEqual([true]);
    expect(target.velocityX).toBe(0);
    context.now = 500;
    enemy('charger').update(target, context, params, 16);
    context.now = 516;
    enemy('charger').update(target, context, params, 16);
    expect(target.velocityX).toBe(200);
    expect(target.telegraphs).toEqual([true, false]);
    context.now = 900;
    enemy('charger').update(target, context, params, 16);
    context.now = 916;
    enemy('charger').update(target, context, params, 16);
    expect(target.telegraphs).toHaveLength(2);
  });

  it('ranged keeps its distance and fires a spread volley on cooldown', () => {
    const params = {
      turnRate: 100, preferredRange: 100, fireCooldownMs: 1000, projectileSpeed: 120,
      projectileDamage: 7, projectileSprite: 'projectiles/slug', lifetimeMs: 1000, shots: 3, spreadDegrees: 30,
    };
    const close = mob(0, 0, 50);
    const { context, log } = enemyContext({ x: 20, y: 0 });
    enemy('ranged').update(close, context, params, 1000);
    expect(close.velocityX).toBeLessThan(0);
    expect(log.shots).toHaveLength(0);
    context.now = 600;
    enemy('ranged').update(close, context, params, 16);
    expect(log.shots).toHaveLength(3);
    expect(log.shots[1]!.vx).toBeCloseTo(120);
    expect(log.shots.every((shot) => shot.damage === 7)).toBe(true);
  });

  it('exploder lights a fuse in range and explodes after it', () => {
    const params = { turnRate: 6, triggerRange: 24, fuseMs: 700, radius: 34, damage: 16 };
    const target = mob(0, 0);
    const { context, log } = enemyContext({ x: 10, y: 0 }, 100);
    enemy('exploder').update(target, context, params, 16);
    expect(target.telegraphs).toEqual([true]);
    context.now = 799;
    enemy('exploder').update(target, context, params, 16);
    expect(log.explosions).toHaveLength(0);
    context.now = 800;
    enemy('exploder').update(target, context, params, 16);
    expect(log.explosions).toEqual([{ radius: 34, damage: 16 }]);
  });

  it('boss changes AI by HP and summons once per new phase', () => {
    const boss = getCatalog().enemies.junk_king!;
    const behavior = enemy('boss_phases');
    const target = mob(0, 0, 40, 1);
    const { context, log } = enemyContext({ x: 300, y: 0 });
    behavior.update(target, context, boss.ai.params, 16);
    expect(log.summons).toEqual([]);
    target.hpFraction = 0.5;
    behavior.update(target, context, boss.ai.params, 16);
    behavior.update(target, context, boss.ai.params, 16);
    expect(log.summons).toEqual([{ id: 'roach', count: 10 }]);
    target.hpFraction = 0.2;
    behavior.update(target, context, boss.ai.params, 16);
    expect(log.summons.at(-1)).toEqual({ id: 'cleaner_bot', count: 8 });
  });
});

function combat(stats: Partial<Record<string, number>> = {}, enemies: Point[] = [{ x: 100, y: 0 }]) {
  const log = {
    projectiles: [] as ProjectileSpec[], zones: [] as ZoneSpec[], hits: [] as number[],
    orbiters: [] as number[], auras: [] as number[],
  };
  const lastHit = new Map<string, number>();
  const context: CombatContext & { now: number } = {
    hero: { x: 0, y: 0 }, now: 0,
    rng: () => 0,
    stat: (key) => stats[key] ?? 0,
    nearestEnemy: () => enemies[0] ?? null,
    randomEnemyWithin: () => enemies[0] ?? null,
    damageInRadius: (_center, _radius, damage, limit) => {
      if (limit) {
        if (context.now - (lastHit.get(limit.owner) ?? -Infinity) < limit.cooldownMs) return 0;
        lastHit.set(limit.owner, context.now);
      }
      log.hits.push(damage);
      return 1;
    },
    spawnProjectile: (spec) => { log.projectiles.push(spec); },
    spawnZone: (spec) => { log.zones.push(spec); },
    placeOrbiters: (_owner, _sprite, positions) => { log.orbiters.push(positions.length); },
    showAura: (_owner, radius) => { log.auras.push(radius); },
  };
  return { context, log };
}

function weapon(id: string): { definition: WeaponDefinition; level: (n: number) => WeaponLevel } {
  const definition = getCatalog().weapons[id]!;
  return { definition, level: (n) => definition.levels[n - 1]! };
}
const state = (): WeaponState => ({ level: 1, clock: 0, activeUntil: 0, angle: 0 });

describe('weapon behaviors', () => {
  it('projectile adds projectileCount shots, bonus damage and pierce', () => {
    const laser = weapon('laser_rifle');
    const { context, log } = combat({ projectileCount: 1, damage: 3 });
    const result = weaponBehaviors.projectile!.fire(context, laser.definition, laser.level(3),
      laser.definition.behavior.params, state());
    expect(result).toBe('fired');
    expect(log.projectiles).toHaveLength(laser.level(3).shots + 1);
    expect(log.projectiles[0]!.damage).toBe(laser.level(3).damage + 3);
    expect(log.projectiles[0]!.pierce).toBe(laser.level(3).pierce);
  });

  it('projectile waits without a target', () => {
    const pistol = weapon('scrap_pistol');
    const { context } = combat({}, []);
    expect(weaponBehaviors.projectile!.fire(context, pistol.definition, pistol.level(1),
      pistol.definition.behavior.params, state())).toBe('skip');
  });

  it('orbit spins drones while active and limits hits per cooldown', () => {
    const drone = weapon('orbit_drone');
    const behavior = weaponBehaviors.orbit!;
    const params = drone.definition.behavior.params;
    const { context, log } = combat({ projectileCount: 1 });
    const own = state();
    behavior.fire(context, drone.definition, drone.level(2), params, own);
    behavior.update!(context, drone.definition, drone.level(2), params, own, 16);
    expect(log.orbiters.at(-1)).toBe(drone.level(2).shots + 1);
    const hits = log.hits.length;
    behavior.update!(context, drone.definition, drone.level(2), params, own, 16);
    expect(log.hits.length).toBe(hits);
    context.now = own.activeUntil;
    behavior.update!(context, drone.definition, drone.level(2), params, own, 16);
    expect(log.orbiters.at(-1)).toBe(0);
  });

  it('aura damages quietly around the hero with area bonus', () => {
    const aura = weapon('rad_aura');
    const { context, log } = combat({ area: 0.5 });
    const result = weaponBehaviors.aura!.fire(context, aura.definition, aura.level(1),
      aura.definition.behavior.params, state());
    weaponBehaviors.aura!.update!(context, aura.definition, aura.level(1),
      aura.definition.behavior.params, state(), 16);
    expect(result).toBe('silent');
    expect(log.hits).toEqual([aura.level(1).damage]);
    expect(log.auras).toEqual([aura.level(1).radius! * 1.5]);
  });

  it('zone throws burning patches with duration and area bonuses', () => {
    const bomb = weapon('firebomb');
    const { context, log } = combat({ duration: 1, area: 1 });
    weaponBehaviors.zone!.fire(context, bomb.definition, bomb.level(3), bomb.definition.behavior.params, state());
    expect(log.zones).toHaveLength(bomb.level(3).shots);
    expect(log.zones[0]!.durationMs).toBe(bomb.level(3).durationMs! * 2);
    expect(log.zones[0]!.radius).toBe(bomb.level(3).radius! * 2);
  });
});

describe('pickup effects', () => {
  function pickupContext(random: number, luck = 0) {
    const log = { caps: 0, heal: 0, attract: 0, blast: 0, chest: [] as number[][] };
    const context: PickupContext = {
      rng: () => random, luck: () => luck, hero: { x: 0, y: 0 },
      heal: (fraction) => { log.heal += fraction; },
      attractAll: () => { log.attract += 1; },
      blast: (_center, _radius, damage) => { log.blast += damage; },
      addCaps: (amount) => { log.caps += amount; },
      openChest: (items, caps) => { log.chest.push([items, caps]); },
    };
    return { context, log };
  }
  const apply = (id: string, context: PickupContext) => {
    const pickup = getCatalog().pickups[id]!;
    pickupEffects[pickup.effect.type]!.apply(context, pickup.effect.params);
  };

  it('applies caps, heal, magnet and blast', () => {
    const { context, log } = pickupContext(0.99);
    apply('caps_stash', context);
    apply('medkit', context);
    apply('magnet', context);
    apply('pulse_bomb', context);
    const params = (id: string) => getCatalog().pickups[id]!.effect.params as Record<string, unknown>;
    expect(log.caps).toBe((params('caps_stash').amount as number[])[1]);
    expect(log.heal).toBe(params('medkit').fraction);
    expect(log.attract).toBe(1);
    expect(log.blast).toBe(params('pulse_bomb').damage);
  });

  it('chest rolls more items with luck', () => {
    const unlucky = pickupContext(0.4, 0);
    const lucky = pickupContext(0.4, 1);
    apply('chest', unlucky.context);
    apply('chest', lucky.context);
    expect(unlucky.log.chest[0]![0]).toBe(2);
    expect(lucky.log.chest[0]![0]).toBe(3);
  });
});

describe('world decor', () => {
  const decor = getCatalog().locations.shelter_outskirts!.decor;

  it('generates the same chunk for the same seed and different ones otherwise', () => {
    expect(generateChunk(42, 3, -2, decor)).toEqual(generateChunk(42, 3, -2, decor));
    expect(generateChunk(42, 3, -2, decor)).not.toEqual(generateChunk(43, 3, -2, decor));
  });

  it('keeps items inside their chunk and within the configured counts', () => {
    for (let cx = -3; cx <= 3; cx += 1) {
      const items = generateChunk(7, cx, 1, decor);
      for (const item of items) {
        expect(item.x).toBeGreaterThanOrEqual(cx * decor.chunkSize);
        expect(item.x).toBeLessThanOrEqual((cx + 1) * decor.chunkSize);
      }
      const crates = items.filter((item) => item.kind === 'crate').length;
      expect(crates).toBeLessThanOrEqual(decor.crates.perChunk[1]);
      expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
    }
  });
});

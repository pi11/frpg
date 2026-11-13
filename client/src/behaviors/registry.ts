import { BossPhasesBehavior } from './enemies/BossPhases';
import { BurrowerEnemyBehavior } from './enemies/Burrower';
import { ChargerEnemyBehavior } from './enemies/Charger';
import { ChaserEnemyBehavior } from './enemies/Chaser';
import { ExploderEnemyBehavior } from './enemies/Exploder';
import { HealerEnemyBehavior } from './enemies/Healer';
import { RangedEnemyBehavior } from './enemies/Ranged';
import { WeaverEnemyBehavior } from './enemies/Weaver';
import { BlastEffect, CapsEffect, ChestEffect, HealEffect, MagnetEffect } from './pickups/effects';
import type { EnemyBehavior, PickupEffect, WeaponBehavior } from './types';
import { AuraWeaponBehavior } from './weapons/Aura';
import { OrbitWeaponBehavior } from './weapons/Orbit';
import { ProjectileWeaponBehavior } from './weapons/Projectile';
import { ZoneWeaponBehavior } from './weapons/Zone';

export const weaponBehaviors: Record<string, WeaponBehavior<unknown> | undefined> = {
  projectile: new ProjectileWeaponBehavior() as WeaponBehavior<unknown>,
  orbit: new OrbitWeaponBehavior() as WeaponBehavior<unknown>,
  aura: new AuraWeaponBehavior() as WeaponBehavior<unknown>,
  zone: new ZoneWeaponBehavior() as WeaponBehavior<unknown>,
};

export const enemyBehaviors: Record<string, EnemyBehavior<unknown> | undefined> = {
  chaser: new ChaserEnemyBehavior() as EnemyBehavior<unknown>,
  charger: new ChargerEnemyBehavior() as EnemyBehavior<unknown>,
  ranged: new RangedEnemyBehavior() as EnemyBehavior<unknown>,
  exploder: new ExploderEnemyBehavior() as EnemyBehavior<unknown>,
  weaver: new WeaverEnemyBehavior() as EnemyBehavior<unknown>,
  burrower: new BurrowerEnemyBehavior() as EnemyBehavior<unknown>,
  healer: new HealerEnemyBehavior() as EnemyBehavior<unknown>,
};
enemyBehaviors.boss_phases = new BossPhasesBehavior(
  (type) => enemyBehaviors[type],
) as EnemyBehavior<unknown>;

export const pickupEffects: Record<string, PickupEffect<unknown> | undefined> = {
  caps: new CapsEffect() as PickupEffect<unknown>,
  heal: new HealEffect() as PickupEffect<unknown>,
  magnet: new MagnetEffect() as PickupEffect<unknown>,
  blast: new BlastEffect() as PickupEffect<unknown>,
  chest: new ChestEffect() as PickupEffect<unknown>,
};

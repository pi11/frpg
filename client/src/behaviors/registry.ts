import { ChaserEnemyBehavior } from './enemies/Chaser';
import { ProjectileWeaponBehavior } from './weapons/Projectile';

export const weaponBehaviors = {
  projectile: new ProjectileWeaponBehavior(),
} as const;

export const enemyBehaviors = {
  chaser: new ChaserEnemyBehavior(),
} as const;

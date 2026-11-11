import { z } from 'zod';
import type { WeaponDefinition, WeaponLevel } from '../../content/schemas';

export const ProjectileParamsSchema = z.object({
  speed: z.number().positive(),
  lifetimeMs: z.number().positive(),
}).strict();

export interface FireContext {
  x: number;
  y: number;
  nearestTarget(): { x: number; y: number } | null;
  spawnProjectile(vx: number, vy: number, damage: number, lifetimeMs: number,
    sprite: string): void;
}

export class ProjectileWeaponBehavior {
  readonly paramsSchema = ProjectileParamsSchema;

  fire(context: FireContext, weapon: WeaponDefinition, level: WeaponLevel,
    bonusDamage: number): void {
    const target = context.nearestTarget();
    if (!target) return;
    const params = weapon.behavior.params as z.infer<typeof ProjectileParamsSchema>;
    const baseAngle = Math.atan2(target.y - context.y, target.x - context.x);
    const spreadRadians = level.spreadDegrees * (Math.PI / 180);
    for (let index = 0; index < level.shots; index += 1) {
      const offset = level.shots === 1 ? 0
        : (index / (level.shots - 1) - 0.5) * spreadRadians;
      const angle = baseAngle + offset;
      context.spawnProjectile(
        Math.cos(angle) * params.speed,
        Math.sin(angle) * params.speed,
        level.damage + bonusDamage,
        params.lifetimeMs,
        weapon.projectileSprite,
      );
    }
  }
}

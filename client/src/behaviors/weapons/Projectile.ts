import { z } from 'zod';
import type { WeaponDefinition, WeaponLevel } from '../../content/schemas';
import type { CombatContext, FireResult, WeaponBehavior } from '../types';

export const ProjectileParamsSchema = z.object({
  speed: z.number().positive(),
  lifetimeMs: z.number().positive(),
}).strict();
type ProjectileParams = z.infer<typeof ProjectileParamsSchema>;

/** Fires a fan of bullets at the nearest enemy; `pierce` lets each pass through enemies. */
export class ProjectileWeaponBehavior implements WeaponBehavior<ProjectileParams> {
  readonly paramsSchema = ProjectileParamsSchema;
  readonly requiredLevelFields = [] as const;

  fire(context: CombatContext, weapon: WeaponDefinition, level: WeaponLevel,
    params: ProjectileParams): FireResult {
    const target = context.nearestEnemy();
    if (!target) return 'skip';
    const shots = level.shots + Math.floor(context.stat('projectileCount'));
    const baseAngle = Math.atan2(target.y - context.hero.y, target.x - context.hero.x);
    // Extra projectiles widen the fan so they do not overlap.
    const spread = (level.spreadDegrees + (shots - level.shots) * 8) * (Math.PI / 180);
    for (let index = 0; index < shots; index += 1) {
      const angle = shots === 1 ? baseAngle : baseAngle + (index / (shots - 1) - 0.5) * spread;
      context.spawnProjectile({
        vx: Math.cos(angle) * params.speed,
        vy: Math.sin(angle) * params.speed,
        damage: level.damage + context.stat('damage'),
        lifetimeMs: params.lifetimeMs,
        sprite: weapon.projectileSprite,
        pierce: level.pierce ?? 0,
      });
    }
    return 'fired';
  }
}

import { z } from 'zod';
import type { WeaponDefinition, WeaponLevel } from '../../content/schemas';
import { fan, type CombatContext, type FireResult, type WeaponBehavior } from '../types';

export const ProjectileParamsSchema = z.object({
  speed: z.number().positive(),
  lifetimeMs: z.number().positive(),
  /** Freezes ordinary enemies on hit. */
  chillMs: z.number().positive().optional(),
}).strict();
type ProjectileParams = z.infer<typeof ProjectileParamsSchema>;

/**
 * Fires a fan of bullets at the nearest enemy; `pierce` lets each pass through enemies. A level's
 * `durationMs` replaces `lifetimeMs`, so a ring of bullets reaches further as the weapon grows.
 */
export class ProjectileWeaponBehavior implements WeaponBehavior<ProjectileParams> {
  readonly paramsSchema = ProjectileParamsSchema;
  readonly requiredLevelFields = [] as const;

  fire(context: CombatContext, weapon: WeaponDefinition, level: WeaponLevel,
    params: ProjectileParams): FireResult {
    const target = context.nearestEnemy();
    if (!target) return 'skip';
    for (const angle of fan(context, level, target)) {
      context.spawnProjectile({
        vx: Math.cos(angle) * params.speed,
        vy: Math.sin(angle) * params.speed,
        damage: level.damage + context.stat('damage'),
        lifetimeMs: level.durationMs ?? params.lifetimeMs,
        sprite: weapon.projectileSprite,
        pierce: level.pierce ?? 0,
        ...(params.chillMs === undefined ? {} : { chillMs: params.chillMs }),
      });
    }
    return 'fired';
  }
}

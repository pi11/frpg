import { z } from 'zod';
import type { WeaponDefinition, WeaponLevel } from '../../content/schemas';
import { fan, type CombatContext, type FireResult, type WeaponBehavior } from '../types';

export const RocketParamsSchema = z.object({
  speed: z.number().positive(),
  lifetimeMs: z.number().positive(),
  /** Homing strength, radians per second. */
  turnRate: z.number().positive(),
}).strict();
type RocketParams = z.infer<typeof RocketParamsSchema>;

/** Homing rockets that explode on the first enemy they reach. */
export class RocketWeaponBehavior implements WeaponBehavior<RocketParams> {
  readonly paramsSchema = RocketParamsSchema;
  readonly requiredLevelFields = ['radius'] as const;

  fire(context: CombatContext, weapon: WeaponDefinition, level: WeaponLevel,
    params: RocketParams): FireResult {
    const target = context.nearestEnemy();
    if (!target) return 'skip';
    for (const angle of fan(context, level, target)) {
      context.spawnProjectile({
        vx: Math.cos(angle) * params.speed,
        vy: Math.sin(angle) * params.speed,
        damage: level.damage + context.stat('damage'),
        lifetimeMs: params.lifetimeMs,
        sprite: weapon.projectileSprite,
        pierce: 0,
        blastRadius: level.radius! * (1 + context.stat('area')),
        turnRate: params.turnRate,
      });
    }
    return 'fired';
  }
}

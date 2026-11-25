import { z } from 'zod';
import type { WeaponDefinition, WeaponLevel } from '../../content/schemas';
import { fan, type CombatContext, type FireResult, type WeaponBehavior } from '../types';

export const BoomerangParamsSchema = z.object({
  speed: z.number().positive(),
  /** Time before the blade turns back. */
  outMs: z.number().positive(),
  returnSpeed: z.number().positive(),
  lifetimeMs: z.number().positive(),
}).strict();
type BoomerangParams = z.infer<typeof BoomerangParamsSchema>;

/** Blades cut through everything, then fly back to the hero and may hit again. */
export class BoomerangWeaponBehavior implements WeaponBehavior<BoomerangParams> {
  readonly paramsSchema = BoomerangParamsSchema;
  readonly requiredLevelFields = [] as const;

  fire(context: CombatContext, weapon: WeaponDefinition, level: WeaponLevel,
    params: BoomerangParams): FireResult {
    const target = context.nearestEnemy();
    if (!target) return 'skip';
    for (const angle of fan(context, level, target)) {
      context.spawnProjectile({
        vx: Math.cos(angle) * params.speed,
        vy: Math.sin(angle) * params.speed,
        damage: level.damage + context.stat('damage'),
        lifetimeMs: params.lifetimeMs,
        sprite: weapon.projectileSprite,
        pierce: Infinity,
        returnAfterMs: params.outMs * (1 + context.stat('duration')),
        returnSpeed: params.returnSpeed,
      });
    }
    return 'fired';
  }
}

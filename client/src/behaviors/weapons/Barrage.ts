import { z } from 'zod';
import type { WeaponDefinition, WeaponLevel } from '../../content/schemas';
import type { CombatContext, FireResult, WeaponBehavior } from '../types';

export const BarrageParamsSchema = z.object({
  /** How far from the hero targets are picked. */
  range: z.number().positive(),
  /** Flight time of a shell; the landing spot is marked meanwhile. */
  delayMs: z.number().positive(),
  /** Pause between shells of one volley. */
  staggerMs: z.number().nonnegative(),
}).strict();
type BarrageParams = z.infer<typeof BarrageParamsSchema>;

/** Shells fall from the sky on random enemies after a short delay. */
export class BarrageWeaponBehavior implements WeaponBehavior<BarrageParams> {
  readonly paramsSchema = BarrageParamsSchema;
  readonly requiredLevelFields = ['radius'] as const;

  fire(context: CombatContext, weapon: WeaponDefinition, level: WeaponLevel,
    params: BarrageParams): FireResult {
    const shells = level.shots + Math.floor(context.stat('projectileCount'));
    for (let index = 0; index < shells; index += 1) {
      const target = context.randomEnemyWithin(params.range);
      if (!target) return index ? 'fired' : 'skip';
      context.scheduleBlast({
        x: target.x, y: target.y,
        delayMs: params.delayMs + index * params.staggerMs,
        radius: level.radius! * (1 + context.stat('area')),
        damage: level.damage + context.stat('damage'),
        sprite: weapon.projectileSprite,
      });
    }
    return 'fired';
  }
}

import { z } from 'zod';
import type { WeaponDefinition, WeaponLevel } from '../../content/schemas';
import type { CombatContext, FireResult, WeaponBehavior } from '../types';

export const MineParamsSchema = z.object({
  /** Mines land at random inside this distance of the hero. */
  scatter: z.number().nonnegative(),
}).strict();
type MineParams = z.infer<typeof MineParamsSchema>;

/** Leaves mines on the ground; an enemy that steps on one sets off a blast. */
export class MineWeaponBehavior implements WeaponBehavior<MineParams> {
  readonly paramsSchema = MineParamsSchema;
  readonly requiredLevelFields = ['radius', 'durationMs'] as const;

  fire(context: CombatContext, weapon: WeaponDefinition, level: WeaponLevel,
    params: MineParams): FireResult {
    const count = level.shots + Math.floor(context.stat('projectileCount'));
    for (let index = 0; index < count; index += 1) {
      const angle = context.rng() * Math.PI * 2;
      const distance = context.rng() * params.scatter;
      context.spawnProjectile({
        at: {
          x: context.hero.x + Math.cos(angle) * distance,
          y: context.hero.y + Math.sin(angle) * distance,
        },
        vx: 0, vy: 0,
        damage: level.damage + context.stat('damage'),
        lifetimeMs: level.durationMs! * (1 + context.stat('duration')),
        sprite: weapon.projectileSprite,
        pierce: 0,
        blastRadius: level.radius! * (1 + context.stat('area')),
      });
    }
    return 'fired';
  }
}

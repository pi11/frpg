import { z } from 'zod';
import { steer, towards } from '../steer';
import type { EnemyBehavior, EnemyContext, Mob } from '../types';

export const HealerParamsSchema = z.object({
  turnRate: z.number().positive(),
  /** Keeps about this far from the hero, behind the others. */
  preferredRange: z.number().positive(),
  healRadius: z.number().positive(),
  /** Share of max HP restored to each ally per pulse. */
  healFraction: z.number().positive().max(1),
  cooldownMs: z.number().positive(),
}).strict();
type HealerParams = z.infer<typeof HealerParamsSchema>;

/** Hangs back from the hero and periodically heals nearby enemies. */
export class HealerEnemyBehavior implements EnemyBehavior<HealerParams> {
  readonly paramsSchema = HealerParamsSchema;

  update(mob: Mob, context: EnemyContext, params: HealerParams, deltaMs: number): void {
    const memory = mob.memory;
    if (!memory.nextHeal) memory.nextHeal = context.now + params.cooldownMs / 2;
    const direction = towards(mob, context.hero);
    let along = 0;
    if (direction.distance > params.preferredRange * 1.1) along = 1;
    else if (direction.distance < params.preferredRange * 0.8) along = -1;
    steer(mob, direction.x * along, direction.y * along, mob.speed, params.turnRate, deltaMs);
    if (context.now >= memory.nextHeal) {
      memory.nextHeal = context.now + params.cooldownMs;
      context.healAround(mob, params.healRadius, params.healFraction);
    }
  }
}

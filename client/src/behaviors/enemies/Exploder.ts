import { z } from 'zod';
import { steer, towards } from '../steer';
import type { EnemyBehavior, EnemyContext, Mob } from '../types';

export const ExploderParamsSchema = z.object({
  turnRate: z.number().positive(),
  triggerRange: z.number().positive(),
  fuseMs: z.number().positive(),
  radius: z.number().positive(),
  damage: z.number().positive(),
}).strict();
type ExploderParams = z.infer<typeof ExploderParamsSchema>;

/** Rolls up to the hero, stops, blinks and blows up. */
export class ExploderEnemyBehavior implements EnemyBehavior<ExploderParams> {
  readonly paramsSchema = ExploderParamsSchema;

  update(mob: Mob, context: EnemyContext, params: ExploderParams, deltaMs: number): void {
    const memory = mob.memory;
    if (memory.fuseAt) {
      mob.setVelocity(0, 0);
      if (context.now >= memory.fuseAt) context.explode(mob, params.radius, params.damage);
      return;
    }
    const direction = towards(mob, context.hero);
    if (direction.distance <= params.triggerRange) {
      memory.fuseAt = context.now + params.fuseMs;
      mob.setVelocity(0, 0);
      mob.telegraph(true);
      return;
    }
    steer(mob, direction.x, direction.y, mob.speed, params.turnRate, deltaMs);
  }
}

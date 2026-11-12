import { z } from 'zod';
import { steer, towards } from '../steer';
import type { EnemyBehavior, EnemyContext, Mob } from '../types';

export const ChaserParamsSchema = z.object({ turnRate: z.number().positive() }).strict();
type ChaserParams = z.infer<typeof ChaserParamsSchema>;

/** Walks straight at the hero. */
export class ChaserEnemyBehavior implements EnemyBehavior<ChaserParams> {
  readonly paramsSchema = ChaserParamsSchema;

  update(mob: Mob, context: EnemyContext, params: ChaserParams, deltaMs: number): void {
    const direction = towards(mob, context.hero);
    if (direction.distance === 0) return;
    steer(mob, direction.x, direction.y, mob.speed, params.turnRate, deltaMs);
  }
}

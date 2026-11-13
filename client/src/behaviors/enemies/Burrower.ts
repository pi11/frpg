import { z } from 'zod';
import { steer, towards } from '../steer';
import type { EnemyBehavior, EnemyContext, Mob } from '../types';

export const BurrowerParamsSchema = z.object({
  turnRate: z.number().positive(),
  /** Time on the surface chasing before digging in. */
  surfaceMs: z.number().positive(),
  undergroundSpeed: z.number().positive(),
  /** Longest time underground before it surfaces wherever it is. */
  maxBurrowMs: z.number().positive(),
  /** Surfaces once this close to the hero. */
  emergeRange: z.number().nonnegative(),
  windupMs: z.number().positive(),
  emergeRadius: z.number().positive(),
  emergeDamage: z.number().nonnegative(),
}).strict();
type BurrowerParams = z.infer<typeof BurrowerParamsSchema>;

const SURFACE = 0;
const UNDERGROUND = 1;
const WINDUP = 2;

/** Chases on the surface, digs in, tunnels under the hero and bursts out with a shockwave. */
export class BurrowerEnemyBehavior implements EnemyBehavior<BurrowerParams> {
  readonly paramsSchema = BurrowerParamsSchema;

  update(mob: Mob, context: EnemyContext, params: BurrowerParams, deltaMs: number): void {
    const memory = mob.memory;
    const direction = towards(mob, context.hero);
    if (!memory.until) memory.until = context.now + params.surfaceMs;

    if (memory.state === UNDERGROUND) {
      steer(mob, direction.x, direction.y, params.undergroundSpeed, params.turnRate * 2, deltaMs);
      if (direction.distance <= params.emergeRange || context.now >= memory.until) {
        memory.state = WINDUP;
        memory.until = context.now + params.windupMs;
        mob.setVelocity(0, 0);
        mob.telegraph(true);
      }
      return;
    }
    if (memory.state === WINDUP) {
      mob.setVelocity(0, 0);
      if (context.now < memory.until) return;
      mob.telegraph(false);
      mob.setBurrowed(false);
      context.shockwave(mob, params.emergeRadius, params.emergeDamage);
      memory.state = SURFACE;
      memory.until = context.now + params.surfaceMs;
      return;
    }
    if (context.now >= memory.until) {
      memory.state = UNDERGROUND;
      memory.until = context.now + params.maxBurrowMs;
      mob.setBurrowed(true);
      return;
    }
    if (direction.distance > 0) steer(mob, direction.x, direction.y, mob.speed, params.turnRate, deltaMs);
  }
}

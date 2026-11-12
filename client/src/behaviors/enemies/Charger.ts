import { z } from 'zod';
import { steer, towards } from '../steer';
import type { EnemyBehavior, EnemyContext, Mob } from '../types';

export const ChargerParamsSchema = z.object({
  turnRate: z.number().positive(),
  chargeRange: z.number().positive(),
  windupMs: z.number().positive(),
  chargeSpeed: z.number().positive(),
  chargeMs: z.number().positive(),
  cooldownMs: z.number().nonnegative(),
}).strict();
type ChargerParams = z.infer<typeof ChargerParamsSchema>;

const CHASE = 0;
const WINDUP = 1;
const CHARGE = 2;

/** Approaches, freezes with a warning, then dashes in a straight line. */
export class ChargerEnemyBehavior implements EnemyBehavior<ChargerParams> {
  readonly paramsSchema = ChargerParamsSchema;

  update(mob: Mob, context: EnemyContext, params: ChargerParams, deltaMs: number): void {
    const memory = mob.memory;
    const direction = towards(mob, context.hero);
    if (memory.state === WINDUP) {
      mob.setVelocity(0, 0);
      if (context.now >= memory.until!) {
        memory.state = CHARGE;
        memory.until = context.now + params.chargeMs;
        memory.dirX = direction.x;
        memory.dirY = direction.y;
        mob.telegraph(false);
      }
      return;
    }
    if (memory.state === CHARGE) {
      mob.setVelocity(memory.dirX! * params.chargeSpeed, memory.dirY! * params.chargeSpeed);
      if (context.now >= memory.until!) {
        memory.state = CHASE;
        memory.readyAt = context.now + params.cooldownMs;
      }
      return;
    }
    if (direction.distance <= params.chargeRange && context.now >= (memory.readyAt ?? 0)) {
      memory.state = WINDUP;
      memory.until = context.now + params.windupMs;
      mob.setVelocity(0, 0);
      mob.telegraph(true);
      return;
    }
    if (direction.distance > 0) steer(mob, direction.x, direction.y, mob.speed, params.turnRate, deltaMs);
  }
}

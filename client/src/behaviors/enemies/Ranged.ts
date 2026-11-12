import { z } from 'zod';
import { steer, towards } from '../steer';
import type { EnemyBehavior, EnemyContext, Mob } from '../types';

export const RangedParamsSchema = z.object({
  turnRate: z.number().positive(),
  preferredRange: z.number().positive(),
  fireCooldownMs: z.number().positive(),
  projectileSpeed: z.number().positive(),
  projectileDamage: z.number().positive(),
  projectileSprite: z.string().regex(/^projectiles\/[a-z][a-z0-9_]*$/),
  lifetimeMs: z.number().positive(),
  shots: z.number().int().positive(),
  spreadDegrees: z.number().nonnegative(),
}).strict();
type RangedParams = z.infer<typeof RangedParamsSchema>;

/** Keeps its distance and fires aimed volleys at the hero. */
export class RangedEnemyBehavior implements EnemyBehavior<RangedParams> {
  readonly paramsSchema = RangedParamsSchema;

  update(mob: Mob, context: EnemyContext, params: RangedParams, deltaMs: number): void {
    const memory = mob.memory;
    const direction = towards(mob, context.hero);
    const range = params.preferredRange;
    if (direction.distance > range * 1.1) {
      steer(mob, direction.x, direction.y, mob.speed, params.turnRate, deltaMs);
    } else if (direction.distance < range * 0.75) {
      steer(mob, -direction.x, -direction.y, mob.speed, params.turnRate, deltaMs);
    } else {
      steer(mob, 0, 0, 0, params.turnRate, deltaMs);
    }
    if (!memory.nextShot) memory.nextShot = context.now + params.fireCooldownMs / 2;
    if (context.now < memory.nextShot || direction.distance > range * 1.6) return;
    memory.nextShot = context.now + params.fireCooldownMs;
    const base = Math.atan2(direction.y, direction.x);
    const spread = params.spreadDegrees * (Math.PI / 180);
    for (let index = 0; index < params.shots; index += 1) {
      const angle = params.shots === 1 ? base : base + (index / (params.shots - 1) - 0.5) * spread;
      context.shoot(mob, Math.cos(angle) * params.projectileSpeed,
        Math.sin(angle) * params.projectileSpeed, params.projectileDamage,
        params.projectileSprite, params.lifetimeMs);
    }
  }
}

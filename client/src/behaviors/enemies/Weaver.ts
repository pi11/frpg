import { z } from 'zod';
import { steer, towards } from '../steer';
import type { EnemyBehavior, EnemyContext, Mob } from '../types';

export const WeaverParamsSchema = z.object({
  turnRate: z.number().positive(),
  /** Sideways share of the velocity at the peak of the weave, 0..1. */
  amplitude: z.number().min(0).max(1),
  /** Full side-to-side swings per second. */
  frequencyHz: z.number().positive(),
}).strict();
type WeaverParams = z.infer<typeof WeaverParamsSchema>;

/** Flies at the hero in a zigzag, which makes it hard to hit with straight shots. */
export class WeaverEnemyBehavior implements EnemyBehavior<WeaverParams> {
  readonly paramsSchema = WeaverParamsSchema;

  update(mob: Mob, context: EnemyContext, params: WeaverParams, deltaMs: number): void {
    const memory = mob.memory;
    // Every mob gets its own phase so a flock does not swing in step.
    if (!memory.seeded) {
      memory.seeded = 1;
      memory.weavePhase = (Math.abs(mob.x * 0.37 + mob.y * 0.61) % 1) * Math.PI * 2;
    }
    const direction = towards(mob, context.hero);
    if (direction.distance === 0) return;
    const swing = Math.sin(memory.weavePhase! + (context.now / 1000) * params.frequencyHz * Math.PI * 2)
      * params.amplitude;
    const forward = Math.sqrt(1 - swing * swing);
    const dirX = direction.x * forward - direction.y * swing;
    const dirY = direction.y * forward + direction.x * swing;
    steer(mob, dirX, dirY, mob.speed, params.turnRate, deltaMs);
  }
}

import { z } from 'zod';
import type { EnemyBehavior, EnemyContext, Mob } from '../types';

export const BossPhasesParamsSchema = z.object({
  /** Ordered by `hpBelow` descending; the first phase must start at 1 (full HP). */
  phases: z.array(z.object({
    hpBelow: z.number().gt(0).max(1),
    ai: z.object({ type: z.string(), params: z.unknown() }).strict(),
    summon: z.object({ enemy: z.string(), count: z.number().int().positive() }).strict().optional(),
  }).strict()).min(1),
}).strict();
type BossPhasesParams = z.infer<typeof BossPhasesParamsSchema>;

type Resolve = (type: string) => EnemyBehavior<unknown> | undefined;

/** Switches to another registered AI as HP drops; each new phase may summon minions. */
export class BossPhasesBehavior implements EnemyBehavior<BossPhasesParams> {
  readonly paramsSchema = BossPhasesParamsSchema;

  constructor(private readonly resolve: Resolve) {}

  validate(params: BossPhasesParams): void {
    let previous = Infinity;
    params.phases.forEach((phase, index) => {
      if (index === 0 && phase.hpBelow !== 1) throw new Error('first boss phase must have hpBelow 1');
      if (phase.hpBelow >= previous) throw new Error('boss phases must have decreasing hpBelow');
      previous = phase.hpBelow;
      if (phase.ai.type === 'boss_phases') throw new Error('boss phases cannot nest');
      const behavior = this.resolve(phase.ai.type);
      if (!behavior) throw new Error(`unknown boss phase AI ${phase.ai.type}`);
      behavior.validate?.(behavior.paramsSchema.parse(phase.ai.params));
    });
  }

  update(mob: Mob, context: EnemyContext, params: BossPhasesParams, deltaMs: number): void {
    let index = 0;
    params.phases.forEach((phase, candidate) => {
      if (mob.hpFraction <= phase.hpBelow) index = candidate;
    });
    const phase = params.phases[index]!;
    if (mob.memory.phase !== index + 1) {
      for (const key of Object.keys(mob.memory)) mob.memory[key] = 0;
      mob.memory.phase = index + 1;
      mob.telegraph(false);
      if (phase.summon && index > 0) context.summon(phase.summon.enemy, phase.summon.count, mob);
    }
    this.resolve(phase.ai.type)?.update(mob, context, phase.ai.params, deltaMs);
  }
}

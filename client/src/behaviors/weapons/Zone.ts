import { z } from 'zod';
import type { WeaponDefinition, WeaponLevel } from '../../content/schemas';
import type { CombatContext, FireResult, WeaponBehavior } from '../types';

export const ZoneParamsSchema = z.object({
  /** How far from the hero targets are picked. */
  range: z.number().positive(),
  tickMs: z.number().positive(),
  fireSprite: z.string().regex(/^fx\/[a-z][a-z0-9_]*$/),
}).strict();
type ZoneParams = z.infer<typeof ZoneParamsSchema>;

/** Throws bottles at random nearby enemies; each leaves a burning patch. */
export class ZoneWeaponBehavior implements WeaponBehavior<ZoneParams> {
  readonly paramsSchema = ZoneParamsSchema;
  readonly requiredLevelFields = ['radius', 'durationMs'] as const;

  fire(context: CombatContext, _weapon: WeaponDefinition, level: WeaponLevel,
    params: ZoneParams): FireResult {
    const shots = level.shots + Math.floor(context.stat('projectileCount'));
    let thrown = 0;
    for (let index = 0; index < shots; index += 1) {
      const target = context.randomEnemyWithin(params.range);
      if (!target) break;
      context.spawnZone({
        x: target.x, y: target.y,
        radius: level.radius! * (1 + context.stat('area')),
        damage: level.damage + context.stat('damage'),
        tickMs: params.tickMs,
        durationMs: level.durationMs! * (1 + context.stat('duration')),
        sprite: params.fireSprite,
      });
      thrown += 1;
    }
    return thrown ? 'fired' : 'skip';
  }
}

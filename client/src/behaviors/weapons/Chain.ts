import { z } from 'zod';
import type { WeaponDefinition, WeaponLevel } from '../../content/schemas';
import type { CombatContext, FireResult, Point, WeaponBehavior } from '../types';

export const ChainParamsSchema = z.object({
  /** How far from the hero the first target may be. */
  range: z.number().positive(),
  jumpRange: z.number().positive(),
  /** Damage multiplier after every jump. */
  falloff: z.number().gt(0).max(1),
}).strict();
type ChainParams = z.infer<typeof ChainParamsSchema>;

/** Lightning hits an enemy and jumps to others nearby; each bolt strikes an enemy once. */
export class ChainWeaponBehavior implements WeaponBehavior<ChainParams> {
  readonly paramsSchema = ChainParamsSchema;
  readonly requiredLevelFields = ['jumps'] as const;

  fire(context: CombatContext, weapon: WeaponDefinition, level: WeaponLevel,
    params: ChainParams): FireResult {
    const bolts = level.shots + Math.floor(context.stat('projectileCount'));
    const reach = 1 + context.stat('area');
    let struck = 0;
    for (let bolt = 0; bolt < bolts; bolt += 1) {
      const path: Point[] = [{ x: context.hero.x, y: context.hero.y }];
      const hit = new Set<Point>();
      let damage = level.damage + context.stat('damage');
      let target = bolt === 0
        ? context.nearestTo(context.hero, params.range * reach, hit)
        : context.randomEnemyWithin(params.range * reach);
      for (let jump = 0; target && jump <= level.jumps!; jump += 1) {
        const at = { x: target.x, y: target.y };
        hit.add(target);
        path.push(at);
        context.strike(target, damage);
        damage *= params.falloff;
        target = context.nearestTo(at, params.jumpRange * reach, hit);
      }
      if (path.length > 1) context.drawBolt(path, weapon.projectileSprite, weapon.color);
      struck += hit.size;
    }
    return struck ? 'fired' : 'skip';
  }
}

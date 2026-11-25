import { z } from 'zod';
import type { WeaponDefinition, WeaponLevel } from '../../content/schemas';
import type { CombatContext, FireResult, WeaponBehavior, WeaponState } from '../types';

export const TurretParamsSchema = z.object({
  range: z.number().positive(),
  shotIntervalMs: z.number().positive(),
  shotSpeed: z.number().positive(),
  shotLifetimeMs: z.number().positive(),
  shotSprite: z.string().regex(/^projectiles\/[a-z][a-z0-9_]*$/),
}).strict();
type TurretParams = z.infer<typeof TurretParamsSchema>;

/** Leaves a turret where the hero stands; it shoots the nearest enemy until it runs out. */
export class TurretWeaponBehavior implements WeaponBehavior<TurretParams> {
  readonly paramsSchema = TurretParamsSchema;
  readonly requiredLevelFields = ['durationMs'] as const;

  fire(context: CombatContext, _weapon: WeaponDefinition, level: WeaponLevel,
    _params: TurretParams, state: WeaponState): FireResult {
    const limit = level.shots + Math.floor(context.stat('projectileCount'));
    const posts = (state.posts ?? []).filter((post) => post.until > context.now);
    posts.push({
      x: context.hero.x, y: context.hero.y, shootAt: context.now,
      until: context.now + level.durationMs! * (1 + context.stat('duration')),
    });
    state.posts = posts.slice(-limit);
    return 'fired';
  }

  update(context: CombatContext, weapon: WeaponDefinition, level: WeaponLevel, params: TurretParams,
    state: WeaponState): void {
    state.posts = (state.posts ?? []).filter((post) => post.until > context.now);
    for (const post of state.posts) {
      if (context.now < post.shootAt) continue;
      const target = context.nearestTo(post, params.range, new Set());
      if (!target) continue;
      post.shootAt = context.now + params.shotIntervalMs / (1 + context.stat('attackSpeed'));
      const angle = Math.atan2(target.y - post.y, target.x - post.x);
      context.spawnProjectile({
        at: { x: post.x, y: post.y },
        vx: Math.cos(angle) * params.shotSpeed, vy: Math.sin(angle) * params.shotSpeed,
        damage: level.damage + context.stat('damage'),
        lifetimeMs: params.shotLifetimeMs, sprite: params.shotSprite, pierce: 0,
      });
    }
    context.placeOrbiters(weapon.id, weapon.projectileSprite, state.posts);
  }
}

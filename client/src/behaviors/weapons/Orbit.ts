import { z } from 'zod';
import type { WeaponDefinition, WeaponLevel } from '../../content/schemas';
import type { CombatContext, FireResult, Point, WeaponBehavior, WeaponState } from '../types';

export const OrbitParamsSchema = z.object({
  /** Radians per second. */
  orbitSpeed: z.number().positive(),
  hitCooldownMs: z.number().positive(),
}).strict();
type OrbitParams = z.infer<typeof OrbitParamsSchema>;

/** Drones circle the hero for `durationMs`, then rest until the cooldown ends. */
export class OrbitWeaponBehavior implements WeaponBehavior<OrbitParams> {
  readonly paramsSchema = OrbitParamsSchema;
  readonly requiredLevelFields = ['radius', 'durationMs'] as const;
  /** Collision radius of one drone; presentation-sized, not balance. */
  private readonly hitRadius = 8;

  fire(context: CombatContext, _weapon: WeaponDefinition, level: WeaponLevel,
    _params: OrbitParams, state: WeaponState): FireResult {
    state.activeUntil = context.now + level.durationMs! * (1 + context.stat('duration'));
    return 'fired';
  }

  update(context: CombatContext, weapon: WeaponDefinition, level: WeaponLevel, params: OrbitParams,
    state: WeaponState, deltaMs: number): void {
    if (context.now >= state.activeUntil) {
      context.placeOrbiters(weapon.id, weapon.projectileSprite, []);
      return;
    }
    state.angle = (state.angle + params.orbitSpeed * deltaMs / 1000) % (Math.PI * 2);
    const count = level.shots + Math.floor(context.stat('projectileCount'));
    const radius = level.radius! * (1 + context.stat('area'));
    const positions: Point[] = [];
    for (let index = 0; index < count; index += 1) {
      const angle = state.angle + (index / count) * Math.PI * 2;
      const position = {
        x: context.hero.x + Math.cos(angle) * radius,
        y: context.hero.y + Math.sin(angle) * radius,
      };
      positions.push(position);
      context.damageInRadius(position, this.hitRadius, level.damage + context.stat('damage'),
        { owner: weapon.id, cooldownMs: params.hitCooldownMs });
    }
    context.placeOrbiters(weapon.id, weapon.projectileSprite, positions);
  }
}

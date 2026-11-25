import { z } from 'zod';
import type { WeaponDefinition, WeaponLevel } from '../../content/schemas';
import type { CombatContext, FireResult, Point, WeaponBehavior, WeaponState } from '../types';

export const BeamParamsSchema = z.object({
  /** Radians per second. */
  turnSpeed: z.number().positive(),
  hitCooldownMs: z.number().positive(),
}).strict();
type BeamParams = z.infer<typeof BeamParamsSchema>;

/** Distance between damage samples along a beam; geometry, not balance. */
const SAMPLE_STEP = 14;
const SAMPLE_RADIUS = 8;

/** Beams sweep around the hero for `durationMs`, then rest until the cooldown ends. */
export class BeamWeaponBehavior implements WeaponBehavior<BeamParams> {
  readonly paramsSchema = BeamParamsSchema;
  readonly requiredLevelFields = ['radius', 'durationMs'] as const;

  fire(context: CombatContext, _weapon: WeaponDefinition, level: WeaponLevel,
    _params: BeamParams, state: WeaponState): FireResult {
    state.activeUntil = context.now + level.durationMs! * (1 + context.stat('duration'));
    return 'fired';
  }

  update(context: CombatContext, weapon: WeaponDefinition, level: WeaponLevel, params: BeamParams,
    state: WeaponState, deltaMs: number): void {
    if (context.now >= state.activeUntil) return;
    state.angle = (state.angle + params.turnSpeed * deltaMs / 1000) % (Math.PI * 2);
    const beams = level.shots + Math.floor(context.stat('projectileCount'));
    const length = level.radius! * (1 + context.stat('area'));
    const { hero } = context;
    for (let index = 0; index < beams; index += 1) {
      const angle = state.angle + (index / beams) * Math.PI * 2;
      const at = (distance: number): Point => ({
        x: hero.x + Math.cos(angle) * distance, y: hero.y + Math.sin(angle) * distance,
      });
      for (let distance = SAMPLE_STEP; distance <= length; distance += SAMPLE_STEP) {
        context.damageInRadius(at(distance), SAMPLE_RADIUS, level.damage + context.stat('damage'),
          { owner: weapon.id, cooldownMs: params.hitCooldownMs });
      }
      context.drawBeam({ x: hero.x, y: hero.y }, at(length));
    }
  }
}

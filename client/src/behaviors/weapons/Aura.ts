import { z } from 'zod';
import type { WeaponDefinition, WeaponLevel } from '../../content/schemas';
import type { CombatContext, FireResult, WeaponBehavior } from '../types';

export const AuraParamsSchema = z.object({}).strict();
type AuraParams = z.infer<typeof AuraParamsSchema>;

/** A field around the hero that damages everything inside once per cooldown tick. */
export class AuraWeaponBehavior implements WeaponBehavior<AuraParams> {
  readonly paramsSchema = AuraParamsSchema;
  readonly requiredLevelFields = ['radius'] as const;

  fire(context: CombatContext, _weapon: WeaponDefinition, level: WeaponLevel): FireResult {
    const radius = level.radius! * (1 + context.stat('area'));
    context.damageInRadius(context.hero, radius, level.damage + context.stat('damage'));
    return 'silent';
  }

  update(context: CombatContext, weapon: WeaponDefinition, level: WeaponLevel): void {
    context.showAura(weapon.id, level.radius! * (1 + context.stat('area')));
  }
}

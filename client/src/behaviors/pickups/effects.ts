import { z } from 'zod';
import { rollRange, type PickupContext, type PickupEffect } from '../types';

const Range = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
  .refine(([min, max]) => min <= max, 'range min must not exceed max');

export const CapsParamsSchema = z.object({ amount: Range }).strict();
/** Adds caps; enemy drops override the amount per instance. */
export class CapsEffect implements PickupEffect<z.infer<typeof CapsParamsSchema>> {
  readonly paramsSchema = CapsParamsSchema;
  apply(context: PickupContext, params: z.infer<typeof CapsParamsSchema>): void {
    context.addCaps(rollRange(params.amount, context.rng()));
  }
}

export const HealParamsSchema = z.object({ fraction: z.number().gt(0).max(1) }).strict();
/** Restores a fraction of max HP. */
export class HealEffect implements PickupEffect<z.infer<typeof HealParamsSchema>> {
  readonly paramsSchema = HealParamsSchema;
  apply(context: PickupContext, params: z.infer<typeof HealParamsSchema>): void {
    context.heal(params.fraction);
  }
}

export const MagnetParamsSchema = z.object({}).strict();
/** Pulls every crystal and loose cap on the map to the hero. */
export class MagnetEffect implements PickupEffect<z.infer<typeof MagnetParamsSchema>> {
  readonly paramsSchema = MagnetParamsSchema;
  apply(context: PickupContext): void {
    context.attractAll();
  }
}

export const BlastParamsSchema = z.object({
  damage: z.number().positive(),
  radius: z.number().positive(),
}).strict();
/** Damages every enemy around the hero. */
export class BlastEffect implements PickupEffect<z.infer<typeof BlastParamsSchema>> {
  readonly paramsSchema = BlastParamsSchema;
  apply(context: PickupContext, params: z.infer<typeof BlastParamsSchema>): void {
    context.blast(context.hero, params.radius, params.damage);
  }
}

export const ChestParamsSchema = z.object({ items: Range, caps: Range }).strict();
/** Opens a chest: luck pushes the roll towards the maximum number of upgrades. */
export class ChestEffect implements PickupEffect<z.infer<typeof ChestParamsSchema>> {
  readonly paramsSchema = ChestParamsSchema;
  apply(context: PickupContext, params: z.infer<typeof ChestParamsSchema>): void {
    const roll = Math.min(0.999999, context.rng() * (1 + Math.max(0, context.luck())));
    context.openChest(rollRange(params.items, roll), rollRange(params.caps, context.rng()));
  }
}

/** Stats a temporary bonus may change; run-long ones (max HP, rerolls, revives) are excluded. */
export const BUFF_STATS = [
  'armor', 'regen', 'moveSpeed', 'damage', 'attackSpeed', 'area', 'duration', 'pickupRadius',
  'xpGain', 'luck', 'radResist', 'critChance',
] as const;

export const BuffParamsSchema = z.object({
  stat: z.enum(BUFF_STATS),
  amount: z.number().positive(),
  durationMs: z.number().positive(),
}).strict();
/** Raises a stat for a while; taking the same bonus again restarts its timer. */
export class BuffEffect implements PickupEffect<z.infer<typeof BuffParamsSchema>> {
  readonly paramsSchema = BuffParamsSchema;
  apply(context: PickupContext, params: z.infer<typeof BuffParamsSchema>, pickupId: string): void {
    context.addBuff(pickupId, params.stat, params.amount, params.durationMs);
  }
}

export const XpParamsSchema = z.object({ fraction: z.number().gt(0).max(1) }).strict();
/** Grants a fraction of the experience needed for the next level. */
export class XpEffect implements PickupEffect<z.infer<typeof XpParamsSchema>> {
  readonly paramsSchema = XpParamsSchema;
  apply(context: PickupContext, params: z.infer<typeof XpParamsSchema>): void {
    context.addXpFraction(params.fraction);
  }
}

export const FreezeParamsSchema = z.object({ durationMs: z.number().positive() }).strict();
/** Stops ordinary enemies in place; elites and bosses shrug it off. */
export class FreezeEffect implements PickupEffect<z.infer<typeof FreezeParamsSchema>> {
  readonly paramsSchema = FreezeParamsSchema;
  apply(context: PickupContext, params: z.infer<typeof FreezeParamsSchema>): void {
    context.freezeEnemies(params.durationMs);
  }
}

export const BulletShieldParamsSchema = z.object({ durationMs: z.number().positive() }).strict();
/** Enemy shots that reach the hero break on a field instead of hurting; a repeat restarts it. */
export class BulletShieldEffect implements PickupEffect<z.infer<typeof BulletShieldParamsSchema>> {
  readonly paramsSchema = BulletShieldParamsSchema;
  apply(context: PickupContext, params: z.infer<typeof BulletShieldParamsSchema>, pickupId: string): void {
    context.shieldFromShots(pickupId, params.durationMs);
  }
}

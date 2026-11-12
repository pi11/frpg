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

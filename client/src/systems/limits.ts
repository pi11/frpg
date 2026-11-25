/** Value above `limit` counts only by `factor`. */
export function softCap(value: number, limit: number, factor: number): number {
  return value <= limit ? value : limit + (value - limit) * factor;
}

/** Refills a damage budget at `perSecond`; it never holds more than one second's worth. */
export function refillBudget(budget: number, perSecond: number, deltaMs: number): number {
  return Math.min(perSecond, budget + perSecond * deltaMs / 1000);
}

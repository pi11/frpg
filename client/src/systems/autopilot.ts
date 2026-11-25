import type { Point } from '../behaviors/types';

/** Presentation-level reflexes of a deliberately simple bot, not balance. */
const DANGER_RANGE = 90;
const SHOT_RANGE = 45;
const BIG_WEIGHT = 3;
const LOOT_WEIGHT = 0.9;
const IDLE = 0.12;

export interface Threat extends Point { big: boolean }

/** Runs from what is close, otherwise towards the nearest loot; null means stand still. */
export function autopilotDirection(
  hero: Point, threats: Iterable<Threat>, shots: Iterable<Point>, loot: Point | null,
): Point | null {
  let x = 0;
  let y = 0;
  const flee = (from: Point, range: number, weight: number): void => {
    const dx = hero.x - from.x;
    const dy = hero.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance >= range) return;
    const push = weight * 2 * (range - distance) / range;
    // Exactly on top of the hero: any way out will do.
    x += distance > 0 ? (dx / distance) * push : push;
    y += distance > 0 ? (dy / distance) * push : 0;
  };
  for (const threat of threats) flee(threat, threat.big ? DANGER_RANGE * 1.5 : DANGER_RANGE, threat.big ? BIG_WEIGHT : 1);
  for (const shot of shots) flee(shot, SHOT_RANGE, 1);
  if (loot) {
    const distance = Math.hypot(loot.x - hero.x, loot.y - hero.y);
    if (distance > 0) {
      x += ((loot.x - hero.x) / distance) * LOOT_WEIGHT;
      y += ((loot.y - hero.y) / distance) * LOOT_WEIGHT;
    }
  }
  const length = Math.hypot(x, y);
  return length < IDLE ? null : { x: x / length, y: y / length };
}

/** Evolution first, then the weapon card, then whatever comes first. */
export function autopilotChoice<T extends { kind: string }>(choices: readonly T[]): T | undefined {
  return choices.find((choice) => choice.kind === 'evolution')
    ?? choices.find((choice) => choice.kind === 'weapon') ?? choices[0];
}

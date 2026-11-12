import type { Mob, Point } from './types';

/** Turn the mob's velocity towards a target speed and direction at `turnRate` per second. */
export function steer(mob: Mob, dirX: number, dirY: number, speed: number, turnRate: number,
  deltaMs: number): void {
  const turn = Math.min(1, (deltaMs / 1000) * turnRate);
  mob.setVelocity(
    mob.velocityX + (dirX * speed - mob.velocityX) * turn,
    mob.velocityY + (dirY * speed - mob.velocityY) * turn,
  );
}

/** Unit vector and distance from `from` to `to` (zero vector when they coincide). */
export function towards(from: Point, to: Point): { x: number; y: number; distance: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  return distance === 0 ? { x: 0, y: 0, distance } : { x: dx / distance, y: dy / distance, distance };
}

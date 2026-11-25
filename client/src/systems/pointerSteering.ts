/** A press shorter than this sends the hero to the point; a longer one steers only while held. */
export const CLICK_MS = 250;
const ARRIVE_DISTANCE = 4;

export interface Point { x: number; y: number }

/** Mouse control: click to walk to a point, hold to follow the cursor. */
export class PointerSteering {
  private screen: Point | null = null;
  private target: Point | null = null;
  private held = false;
  private pressedAt = 0;

  press(x: number, y: number, now: number): void {
    this.held = true;
    this.pressedAt = now;
    this.screen = { x, y };
  }

  move(x: number, y: number): void {
    if (this.held) this.screen = { x, y };
  }

  release(now: number): void {
    if (!this.held) return;
    this.held = false;
    if (now - this.pressedAt >= CLICK_MS) this.cancel();
  }

  cancel(): void {
    this.held = false;
    this.screen = null;
    this.target = null;
  }

  /** Unit direction for this frame, or null when there is nowhere to go. */
  direction(hero: Point, toWorld: (screen: Point) => Point): Point | null {
    // The cursor stays put on screen while the camera moves, so a held point is re-read every frame.
    if (this.screen) this.target = toWorld(this.screen);
    if (!this.held) this.screen = null;
    if (!this.target) return null;
    const dx = this.target.x - hero.x;
    const dy = this.target.y - hero.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= ARRIVE_DISTANCE) {
      this.target = null;
      return null;
    }
    return { x: dx / distance, y: dy / distance };
  }
}

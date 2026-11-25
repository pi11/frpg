import { describe, expect, it } from 'vitest';
import { CLICK_MS, PointerSteering } from './pointerSteering';

const world = (camera: number) => ({ x, y }: { x: number; y: number }) => ({ x: x + camera, y });
const hero = { x: 0, y: 0 };

describe('mouse steering', () => {
  it('walks to a clicked point and stops there', () => {
    const steering = new PointerSteering();
    steering.press(100, 0, 0);
    steering.release(CLICK_MS - 1);
    expect(steering.direction(hero, world(0))).toEqual({ x: 1, y: 0 });
    // The target is a fixed place in the world: the moving camera does not drag it along.
    expect(steering.direction({ x: 90, y: 0 }, world(90))).toEqual({ x: 1, y: 0 });
    expect(steering.direction({ x: 98, y: 0 }, world(98))).toBeNull();
    expect(steering.direction(hero, world(0))).toBeNull();
  });

  it('follows a held cursor and stops on release', () => {
    const steering = new PointerSteering();
    steering.press(100, 0, 0);
    expect(steering.direction(hero, world(0))).toEqual({ x: 1, y: 0 });
    expect(steering.direction({ x: 500, y: 0 }, world(500))).toEqual({ x: 1, y: 0 });
    steering.move(-100, 0);
    expect(steering.direction(hero, world(0))).toEqual({ x: -1, y: 0 });
    steering.release(CLICK_MS);
    expect(steering.direction(hero, world(0))).toBeNull();
  });

  it('ignores moves without a press and can be cancelled', () => {
    const steering = new PointerSteering();
    steering.move(50, 50);
    expect(steering.direction(hero, world(0))).toBeNull();
    steering.press(100, 0, 0);
    steering.cancel();
    expect(steering.direction(hero, world(0))).toBeNull();
  });
});

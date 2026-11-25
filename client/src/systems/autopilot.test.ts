import { describe, expect, it } from 'vitest';
import { autopilotChoice, autopilotDirection } from './autopilot';

const hero = { x: 0, y: 0 };

describe('autopilot', () => {
  it('runs from close enemies and ignores far ones', () => {
    const away = autopilotDirection(hero, [{ x: 30, y: 0, big: false }], [], null)!;
    expect(away.x).toBeCloseTo(-1);
    expect(autopilotDirection(hero, [{ x: 300, y: 0, big: false }], [], null)).toBeNull();
    expect(autopilotDirection(hero, [{ x: 120, y: 0, big: true }], [], null)!.x).toBeCloseTo(-1);
    expect(autopilotDirection(hero, [{ x: 0, y: 0, big: false }], [], null)).not.toBeNull();
  });

  it('dodges shots and walks to loot when it is safe', () => {
    expect(autopilotDirection(hero, [], [{ x: 0, y: 20 }], null)!.y).toBeCloseTo(-1);
    expect(autopilotDirection(hero, [], [], { x: 0, y: 50 })).toEqual({ x: 0, y: 1 });
    expect(autopilotDirection(hero, [], [], null)).toBeNull();
  });

  it('prefers evolutions, then weapons', () => {
    const passive = { kind: 'passive' };
    const weapon = { kind: 'weapon' };
    const evolution = { kind: 'evolution' };
    expect(autopilotChoice([passive, weapon, evolution])).toBe(evolution);
    expect(autopilotChoice([passive, weapon])).toBe(weapon);
    expect(autopilotChoice([passive])).toBe(passive);
    expect(autopilotChoice([])).toBeUndefined();
  });
});

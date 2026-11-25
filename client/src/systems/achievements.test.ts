import { describe, expect, it } from 'vitest';
import { getCatalog } from '../content/catalog';
import { isReached, newRecord, type RunRecord } from './achievements';

const reached = (id: string, changes: Partial<RunRecord>): boolean =>
  isReached(getCatalog().achievements[id]!, { ...newRecord(12), ...changes });

describe('achievements noticed by the client', () => {
  it('standing still and taking no damage need the time', () => {
    expect(reached('rooted', { seconds: 119 })).toBe(false);
    expect(reached('rooted', { seconds: 120 })).toBe(true);
    expect(reached('rooted', { seconds: 120, moved: true })).toBe(false);
    expect(reached('untouched', { seconds: 180 })).toBe(true);
    expect(reached('untouched', { seconds: 180, damaged: true })).toBe(false);
    expect(reached('one_gun', { seconds: 400, weapons: 2 })).toBe(false);
    expect(reached('one_gun', { seconds: 400 })).toBe(true);
  });

  it('run endings', () => {
    expect(reached('statue', { seconds: 900 })).toBe(false);
    expect(reached('statue', { seconds: 900, end: 'survived' })).toBe(true);
    expect(reached('statue', { seconds: 900, end: 'death' })).toBe(false);
    expect(reached('brave_fool', { seconds: 20, end: 'death' })).toBe(true);
    expect(reached('brave_fool', { seconds: 31, end: 'death' })).toBe(false);
    expect(reached('forgot_iron', { seconds: 9, end: 'quit' })).toBe(true);
    expect(reached('forgot_iron', { seconds: 9, end: 'death' })).toBe(false);
  });

  it('boss, clicks, pauses, hazards, night and evolutions', () => {
    expect(reached('boss_blitz', { seconds: 830 })).toBe(false);
    expect(reached('boss_blitz', { seconds: 830, bossSeconds: 54 })).toBe(true);
    expect(reached('boss_blitz', { seconds: 850, bossSeconds: 60 })).toBe(false);
    expect(reached('tickle', { heroClicks: 9 })).toBe(false);
    expect(reached('tickle', { heroClicks: 10 })).toBe(true);
    expect(reached('indecisive', { pauses: 10 })).toBe(true);
    expect(reached('mud_bath', { seconds: 60, hazardMs: 20000 })).toBe(true);
    expect(reached('night_owl', { startHour: 3 })).toBe(true);
    expect(reached('night_owl', {})).toBe(false);
    expect(reached('evolver', { seconds: 200, evolved: true })).toBe(true);
  });

  it('the autopilot earns only its own', () => {
    expect(reached('tea_time', { seconds: 700, autopilotMs: 600000 })).toBe(true);
    expect(reached('tea_time', { seconds: 700 })).toBe(false);
    expect(reached('tickle', { heroClicks: 10, autopilotMs: 16 })).toBe(false);
  });

  it('has visible and hidden achievements, metric ones are never reported', () => {
    const all = Object.values(getCatalog().achievements);
    expect(all.filter((item) => item.hidden).length).toBeGreaterThanOrEqual(5);
    expect(all.filter((item) => !item.hidden).length).toBeGreaterThanOrEqual(5);
    expect(reached('first_hundred', { seconds: 900 })).toBe(false);
  });
});

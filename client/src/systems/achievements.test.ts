import { describe, expect, it } from 'vitest';
import { getCatalog } from '../content/catalog';
import { isReached, newRecord, type RunRecord } from './achievements';

const reached = (id: string, changes: Partial<RunRecord>): boolean =>
  isReached(getCatalog().achievements[id]!, { ...newRecord(12), ...changes });

describe('achievements noticed by the client', () => {
  it('standing still and taking no damage need the time', () => {
    expect(reached('rooted', { seconds: 89 })).toBe(false);
    expect(reached('rooted', { seconds: 90 })).toBe(true);
    expect(reached('rooted', { seconds: 90, moved: true })).toBe(false);
    expect(reached('untouched', { seconds: 140 })).toBe(true);
    expect(reached('untouched', { seconds: 140, damaged: true })).toBe(false);
    expect(reached('one_gun', { seconds: 300, weapons: 2 })).toBe(false);
    expect(reached('one_gun', { seconds: 300 })).toBe(true);
  });

  it('run endings', () => {
    expect(reached('statue', { seconds: 690 })).toBe(false);
    expect(reached('statue', { seconds: 690, end: 'survived' })).toBe(true);
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

  it('oddities', () => {
    expect(reached('knock_knock', { knocks: 7 })).toBe(true);
    expect(reached('by_a_thread', {})).toBe(false);
    expect(reached('by_a_thread', { lowestHp: 2.5 })).toBe(true);
    expect(reached('lucky_seven', { seconds: 300, kills: 777 })).toBe(false);
    expect(reached('lucky_seven', { seconds: 300, kills: 777, end: 'quit' })).toBe(true);
    expect(reached('lucky_seven', { seconds: 300, kills: 778, end: 'death' })).toBe(false);
    expect(reached('crate_breaker', { seconds: 90, crates: 40 })).toBe(true);
    expect(reached('ice_age', { seconds: 90, frozen: 24 })).toBe(false);
    expect(reached('drunk_master', { flips: 20 })).toBe(true);
    expect(reached('indifferent', { seconds: 60, autoPicks: 5 })).toBe(true);
    expect(reached('pacifist', { seconds: 45 })).toBe(true);
    expect(reached('pacifist', { seconds: 45, kills: 1 })).toBe(false);
    expect(reached('perpetual', { seconds: 180, idleMs: 900 })).toBe(true);
    expect(reached('perpetual', { seconds: 180, idleMs: 2000 })).toBe(false);
    expect(reached('cartographer', { seconds: 90, landmarks: 6 })).toBe(true);
    expect(reached('broke', { broke: true })).toBe(true);
    expect(reached('boss_waits', { seconds: 900, end: 'survived', bossSpawned: true })).toBe(true);
    expect(reached('boss_waits', { seconds: 900, end: 'survived', bossSpawned: true, bossSeconds: 60 })).toBe(false);
  });

  it('hard hidden ones', () => {
    const won = { seconds: 800, bossSeconds: 50, bossSpawned: true, bossHp: 0.5 };
    expect(reached('flawless', won)).toBe(true);
    expect(reached('flawless', { ...won, damaged: true })).toBe(false);
    expect(reached('flawless', { seconds: 800 })).toBe(false);
    expect(reached('bare_hands', won)).toBe(true);
    expect(reached('bare_hands', { ...won, weapons: 2 })).toBe(false);
    expect(reached('no_perks', { ...won, passives: 1 })).toBe(false);
    expect(reached('no_upgrades', { ...won, upgrades: 3 })).toBe(false);
    expect(reached('no_upgrades', won)).toBe(true);
    expect(reached('last_breath', won)).toBe(false);
    expect(reached('last_breath', { ...won, bossHp: 0.09 })).toBe(true);
    expect(reached('collector', { seconds: 400, evolutions: 3 })).toBe(true);
    expect(reached('absolute_zero', { seconds: 60, frozen: 59 })).toBe(false);
    expect(reached('true_pacifist', { seconds: 180 })).toBe(true);
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

import { beforeEach, describe, expect, it } from 'vitest';
import { loadSeen, newSince, openedNow, saveSeen, tabOpen } from './progression';

const fresh = {
  runs_count: 0, emeralds: 0, unlocks: [], milestones: {}, bosses_killed: [], achievements: [],
  unlocked_heroes: ['wanderer'], open_items: ['scrap_pistol', 'scattergun'],
};

describe('shelter progression', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => store.clear(), key: () => null, length: 0,
    };
  });

  it('starts with every gated tab closed and opens them one run at a time', () => {
    expect(openedNow(fresh).tabs).toEqual([]);
    expect(openedNow({ ...fresh, runs_count: 1 }).tabs).toEqual(['upgrades']);
    expect(openedNow({ ...fresh, runs_count: 2 }).tabs).toEqual(['upgrades', 'heroes']);
    expect(openedNow({ ...fresh, runs_count: 3 }).tabs).toEqual(['upgrades', 'heroes', 'daily']);
  });

  it('opens the emerald tab with any emerald source and keeps it open after spending', () => {
    expect(tabOpen('shop', { ...fresh, milestones: { shelter_outskirts: [230] } })).toBe(true);
    expect(tabOpen('shop', { ...fresh, emeralds: 2 })).toBe(true);
    expect(tabOpen('shop', { ...fresh, unlocks: ['rail_gun'] })).toBe(true);
    expect(tabOpen('achievements', { ...fresh, achievements: ['regular'] })).toBe(true);
    expect(tabOpen('shop', fresh)).toBe(false);
  });

  it('reports only what opened since the last visit, nothing on the first one', () => {
    const before = openedNow(fresh);
    expect(newSince(undefined, before)).toEqual({ tabs: [], items: [], heroes: [] });
    const after = openedNow({ ...fresh, runs_count: 1, open_items: [...fresh.open_items, 'trap_mine'] });
    expect(newSince(before, after)).toEqual({ tabs: ['upgrades'], items: ['trap_mine'], heroes: [] });
  });

  it('remembers what was seen per account', () => {
    expect(loadSeen('a')).toBeUndefined();
    saveSeen('a', { tabs: ['upgrades'], items: [], heroes: [], visited: [] });
    expect(loadSeen('a')?.tabs).toEqual(['upgrades']);
    expect(loadSeen('b')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import type { Profile } from '../api/game';
import { getCatalog } from '../content/catalog';
import { damageRows, evolutionHint, nextGoal, plural, recordLines } from './runReport';

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    user_id: 'u', is_guest: true, is_admin: false, caps: 0, emeralds: 0, unlocks: [], achievements: [],
    achievements_unclaimed: [], daily: { date: '', resets_at: '', quests: [] }, milestones: {}, version: 1,
    schema_version: 1, best_time_s: 0, upgrades: {}, runs_count: 1, bosses_killed: [],
    unlocked_locations: ['shelter_outskirts'], unlocked_heroes: ['wanderer'], open_items: [], speeds: {},
    wins: {}, boosts: [], identities: [], ...overrides,
  };
}

describe('damage rows', () => {
  it('keeps the top three weapons and joins the rest with other damage', () => {
    const rows = damageRows([
      ['scrap_pistol', 500], ['nail_gun', 300], ['tesla_coil', 100], ['saw_blade', 60], ['', 40],
    ], getCatalog());
    expect(rows.map((row) => row.name)).toEqual(['Самодельный пистолет', 'Гвоздемёт', 'Катушка-разрядник', 'Другое']);
    expect(rows[3]!.amount).toBe(100);
    expect(rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1);
  });

  it('is empty without hits and has no «Другое» when everything is named', () => {
    expect(damageRows([], getCatalog())).toEqual([]);
    expect(damageRows([['scrap_pistol', 0]], getCatalog())).toEqual([]);
    expect(damageRows([['scrap_pistol', 10]], getCatalog()).map((row) => row.id)).toEqual(['scrap_pistol']);
  });
});

describe('next goal', () => {
  const catalog = getCatalog();

  it('names the boss that opens the next location first', () => {
    const goal = nextGoal(profile(), catalog)!;
    expect(goal).toContain(catalog.locations.shelter_outskirts!.name);
    expect(goal).toContain(catalog.enemies[catalog.locations.shelter_outskirts!.boss.enemy]!.name);
  });

  it('moves on once the location is open and never offers what is done', () => {
    const all = Object.keys(catalog.locations);
    const opened = profile({ unlocked_locations: all, bosses_killed: all, runs_count: 0 });
    const goal = nextGoal(opened, catalog);
    expect(goal).not.toContain('чтобы открыть');
    const heroes = Object.keys(catalog.heroes);
    const items = [...Object.keys(catalog.weapons), ...Object.keys(catalog.passives)];
    const done = profile({ unlocked_locations: all, bosses_killed: all, unlocked_heroes: heroes, open_items: items });
    expect(nextGoal(done, catalog)).toBeNull();
  });

  it('then suggests an affordable purchase, then a faster boss win', () => {
    const all = Object.keys(catalog.locations);
    const base = {
      unlocked_locations: all, bosses_killed: all, unlocked_heroes: Object.keys(catalog.heroes),
      open_items: [...Object.keys(catalog.weapons), ...Object.keys(catalog.passives)],
    };
    expect(nextGoal(profile({ ...base, caps: 100000 }), catalog)).toContain('крышек');
    const faster = nextGoal(profile({
      ...base, wins: { shelter_outskirts: { wanderer: 100 } }, speeds: { shelter_outskirts: [100, 150] },
    }), catalog);
    expect(faster).toContain('×1,5');
    expect(nextGoal(profile({
      ...base, wins: { shelter_outskirts: { wanderer: 150 } }, speeds: { shelter_outskirts: [100, 150] },
    }), catalog)).toBeNull();
  });
});

describe('evolution hint', () => {
  it('names the missing perk of a maxed weapon', () => {
    const hint = evolutionHint({ weapons: [['scrap_pistol', 8]], passives: [] }, getCatalog());
    expect(hint).toContain('нужен перк');
  });

  it('is silent after an evolution or when far from one', () => {
    const catalog = getCatalog();
    expect(evolutionHint({ weapons: [['nail_gun', 1]], passives: [] }, catalog)).toBeNull();
    expect(evolutionHint({ weapons: [['scrap_pistol', 2]], passives: [] }, catalog)).toBeNull();
    expect(evolutionHint({ weapons: [['scrap_pistol', 6]], passives: [['trigger_spring', 1]] }, catalog))
      .toContain('6/8');
  });
});

describe('records and plurals', () => {
  it('tells a new record from an old one', () => {
    expect(recordLines(null)).toEqual([]);
    expect(recordLines({ seconds: 10, kills: 1, previous_seconds: null, previous_kills: null })[0]).toContain('Первая');
    expect(recordLines({ seconds: 300, kills: 10, previous_seconds: 200, previous_kills: 20 }))
      .toEqual(['Новый рекорд времени!']);
    expect(recordLines({ seconds: 100, kills: 10, previous_seconds: 200, previous_kills: 21 })[0])
      .toBe('Рекорд здесь: 3:20, 21 убийство.');
  });

  it('declines Russian nouns', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((count) => plural(count, 'забег', 'забега', 'забегов')))
      .toEqual(['забег', 'забега', 'забегов', 'забегов', 'забег', 'забега', 'забегов']);
  });
});

import type { Profile } from '../api/game';

/**
 * Shelter tabs open one by one as the player gets further, so the first screen is short and
 * every early run brings something new. The rules only read the profile, so a player who
 * already got further sees everything at once.
 */
export type GatedTab = 'upgrades' | 'heroes' | 'shop' | 'daily' | 'achievements';

type ProgressFields = Pick<Profile, 'runs_count' | 'emeralds' | 'unlocks' | 'milestones'
  | 'bosses_killed' | 'achievements' | 'unlocked_heroes'>;

const RULES: Record<GatedTab, { open: (profile: ProgressFields) => boolean; hint: string }> = {
  upgrades: { open: (profile) => profile.runs_count >= 1, hint: 'после первой вылазки' },
  heroes: { open: (profile) => profile.runs_count >= 2 || profile.unlocked_heroes.length > 1,
    hint: 'после второй вылазки' },
  achievements: { open: (profile) => profile.achievements.length > 0, hint: 'с первым достижением' },
  shop: {
    // Every way to get emeralds leaves a trace, so spending them all does not close the tab.
    open: (profile) => profile.emeralds > 0 || profile.unlocks.length > 0 || profile.achievements.length > 0
      || profile.bosses_killed.length > 0 || Object.values(profile.milestones).some((marks) => marks.length > 0),
    hint: 'с первым изумрудом',
  },
  daily: { open: (profile) => profile.runs_count >= 3, hint: 'после третьей вылазки' },
};

export function isGated(tab: string): tab is GatedTab {
  return tab in RULES;
}

export function tabOpen(tab: GatedTab, profile: ProgressFields): boolean {
  return RULES[tab].open(profile);
}

/** "Откроется после первой вылазки" and the like. */
export function tabHint(tab: GatedTab): string {
  return `Откроется ${RULES[tab].hint}`;
}

/** Everything that can open: tabs, weapons and perks, heroes. */
export interface Opened {
  tabs: string[];
  items: string[];
  heroes: string[];
}

export function openedNow(profile: ProgressFields & Pick<Profile, 'open_items'>): Opened {
  return {
    tabs: (Object.keys(RULES) as GatedTab[]).filter((tab) => tabOpen(tab, profile)),
    items: [...profile.open_items],
    heroes: [...profile.unlocked_heroes],
  };
}

/** What opened since `seen`; a profile without a record yet has nothing new. */
export function newSince(seen: Opened | undefined, now: Opened): Opened {
  if (!seen) return { tabs: [], items: [], heroes: [] };
  const fresh = (before: string[], after: string[]) => after.filter((id) => !before.includes(id));
  return { tabs: fresh(seen.tabs, now.tabs), items: fresh(seen.items, now.items), heroes: fresh(seen.heroes, now.heroes) };
}

const SEEN_KEY = 'wasteland.seen.v1';

interface SeenStore {
  [userId: string]: Opened & { visited?: string[] };
}

function readStore(): SeenStore {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}');
    return value && typeof value === 'object' ? value as SeenStore : {};
  } catch { return {}; }
}

function writeStore(store: SeenStore): void {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(store)); } catch { /* only a convenience */ }
}

export function loadSeen(userId: string): (Opened & { visited: string[] }) | undefined {
  const entry = readStore()[userId];
  if (!entry || !Array.isArray(entry.tabs) || !Array.isArray(entry.items) || !Array.isArray(entry.heroes)) {
    return undefined;
  }
  return { ...entry, visited: Array.isArray(entry.visited) ? entry.visited : [...entry.tabs] };
}

export function saveSeen(userId: string, seen: Opened & { visited: string[] }): void {
  writeStore({ ...readStore(), [userId]: seen });
}

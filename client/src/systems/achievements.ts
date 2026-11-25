import type { AchievementDefinition } from '../content/schemas';

/** What the run remembers for achievements that only the client can notice. */
export interface RunRecord {
  seconds: number;
  moved: boolean;
  damaged: boolean;
  /** Most weapons owned at once. */
  weapons: number;
  evolved: boolean;
  bossSeconds: number | null;
  heroClicks: number;
  pauses: number;
  hazardMs: number;
  startHour: number;
  autopilotMs: number;
  /** Set when the run is over. */
  end: 'death' | 'survived' | 'quit' | null;
}

export function newRecord(startHour: number): RunRecord {
  return {
    seconds: 0, moved: false, damaged: false, weapons: 1, evolved: false, bossSeconds: null,
    heroClicks: 0, pauses: 0, hazardMs: 0, startHour, autopilotMs: 0, end: null,
  };
}

export function isReached(achievement: AchievementDefinition, record: RunRecord): boolean {
  const { condition } = achievement;
  if (condition.type !== 'reported' || record.seconds < condition.minSeconds) return false;
  // With the autopilot only its own achievements count.
  if (condition.autopilot !== record.autopilotMs > 0) return false;
  if (condition.boss && record.bossSeconds === null) return false;
  const { value } = condition;
  switch (condition.event) {
    case 'noMove': return !record.moved && record.seconds >= value;
    case 'finishNoMove': return !record.moved && record.end === 'survived';
    case 'noDamage': return !record.damaged && record.seconds >= value;
    case 'singleWeapon': return record.weapons <= 1 && record.seconds >= value;
    case 'evolved': return record.evolved;
    case 'bossFast': return record.bossSeconds !== null && record.bossSeconds < value;
    case 'heroClicks': return record.heroClicks >= value;
    case 'earlyDeath': return record.end === 'death' && record.seconds <= value;
    case 'earlyQuit': return record.end === 'quit' && record.seconds <= value;
    case 'autopilotTime': return record.autopilotMs >= value * 1000;
    case 'pauses': return record.pauses >= value;
    case 'hazardTime': return record.hazardMs >= value * 1000;
    case 'nightHour': return record.startHour === value;
  }
}

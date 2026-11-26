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
  /** Knocks on the shelter door before the run. */
  knocks: number;
  /** Lowest HP the hero survived with. */
  lowestHp: number;
  kills: number;
  crates: number;
  /** Most enemies frozen at once. */
  frozen: number;
  /** Quick left-right turns in a row, and the best row. */
  flips: number;
  autoPicks: number;
  idleMs: number;
  landmarks: number;
  broke: boolean;
  bossSpawned: boolean;
  /** Most perks owned at once, evolutions taken, shelter upgrade levels at the start. */
  passives: number;
  evolutions: number;
  upgrades: number;
  /** Share of HP left when the boss died. */
  bossHp: number | null;
  /** Game speed in percent. */
  speed: number;
  /** Set when the run is over. */
  end: 'death' | 'survived' | 'quit' | null;
}

export function newRecord(startHour: number, knocks = 0, speed = 100): RunRecord {
  return {
    seconds: 0, moved: false, damaged: false, weapons: 1, evolved: false, bossSeconds: null,
    heroClicks: 0, pauses: 0, hazardMs: 0, startHour, autopilotMs: 0, end: null,
    knocks, lowestHp: Infinity, kills: 0, crates: 0, frozen: 0, flips: 0, autoPicks: 0, idleMs: 0,
    landmarks: 0, broke: false, bossSpawned: false,
    passives: 0, evolutions: 0, upgrades: 0, bossHp: null, speed,
  };
}

/** Time to grab the controls at the start. */
const IDLE_GRACE_MS = 1500;

export function isReached(achievement: AchievementDefinition, record: RunRecord): boolean {
  const { condition } = achievement;
  if (condition.type !== 'reported' || record.seconds < condition.minSeconds) return false;
  if (record.speed < condition.minSpeed) return false;
  // With the autopilot only its own achievements count.
  if (condition.autopilot !== record.autopilotMs > 0) return false;
  if (condition.boss && record.bossSeconds === null) return false;
  const { value } = condition;
  switch (condition.event) {
    case 'noMove': return !record.moved && record.seconds >= value;
    case 'finishNoMove': return !record.moved && record.end === 'survived';
    case 'noDamage': return !record.damaged && record.seconds >= value;
    case 'singleWeapon': return record.weapons <= 1 && record.seconds >= value;
    case 'knocks': return record.knocks >= value;
    case 'lowHp': return record.lowestHp <= value;
    case 'exactKills': return record.end !== null && record.kills === value;
    case 'crates': return record.crates >= value;
    case 'frozen': return record.frozen >= value;
    case 'flips': return record.flips >= value;
    case 'autoPicks': return record.autoPicks >= value;
    case 'noKills': return record.kills === 0 && record.seconds >= value;
    case 'alwaysMoving': return record.idleMs < IDLE_GRACE_MS && record.seconds >= value;
    case 'landmarks': return record.landmarks >= value;
    case 'broke': return record.broke;
    case 'bossIgnored':
      return record.end === 'survived' && record.bossSpawned && record.bossSeconds === null;
    case 'flawless': return record.bossSeconds !== null && !record.damaged;
    case 'bossOneGun': return record.bossSeconds !== null && record.weapons <= 1;
    case 'noPerks': return record.bossSeconds !== null && record.passives === 0;
    case 'noUpgrades': return record.bossSeconds !== null && record.upgrades === 0;
    case 'bossLowHp': return record.bossHp !== null && record.bossHp * 100 < value;
    case 'evolutions': return record.evolutions >= value;
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

import { request } from './auth';

export interface Profile {
  user_id: string;
  is_guest: boolean;
  caps: number;
  version: number;
  schema_version: number;
  best_time_s: number;
  upgrades: Record<string, number>;
  runs_count: number;
  /** Locations whose boss was killed at least once. */
  bosses_killed: string[];
  /** Locations open for this profile (checked again by the server on run start). */
  unlocked_locations: string[];
  identities: { provider: string; subject: string }[];
}

export interface RunStart {
  run_id: string;
  seed: number;
  content_hash: string;
}

export interface RunSummary {
  content_hash: string;
  duration_seconds: number;
  kills_by_type: Record<string, number>;
  wave_reached: number;
  boss_killed: boolean;
  picked_caps: number;
}

export interface RunFinish {
  status: 'finished';
  reward_caps: number;
  flags: string[];
  profile: Profile;
}

export function getProfile(): Promise<Profile> {
  return request<Profile>('/profile', {}, true);
}

export function buyUpgrade(id: string, expectedVersion: number): Promise<Profile> {
  return request<Profile>(`/upgrades/${encodeURIComponent(id)}/buy`, {
    method: 'POST', body: JSON.stringify({ expected_version: expectedVersion }),
  }, true);
}

export function startRun(locationId: string, heroId: string): Promise<RunStart> {
  return request<RunStart>('/runs/start', {
    method: 'POST', body: JSON.stringify({ location_id: locationId, hero_id: heroId }),
  }, true);
}

export function finishRun(runId: string, summary: RunSummary): Promise<RunFinish> {
  return request<RunFinish>(`/runs/${encodeURIComponent(runId)}/finish`, {
    method: 'POST', body: JSON.stringify(summary),
  }, true);
}

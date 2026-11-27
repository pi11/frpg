import { request } from './auth';

/** Mirrors server/app/api/admin.py. */
export interface AdminCount { key: string; runs: number; bosses: number }

export interface AdminStats {
  users_total: number;
  users_guests: number;
  users_admins: number;
  users_new_today: number;
  users_new_week: number;
  active_today: number;
  active_week: number;
  runs_total: number;
  runs_in_progress: number;
  runs_today: number;
  runs_week: number;
  flagged_week: number;
  boss_kills_week: number;
  avg_duration_week: number;
  caps_total: number;
  emeralds_total: number;
  locations_week: AdminCount[];
  heroes_week: AdminCount[];
  speeds_week: AdminCount[];
  days: { day: string; runs: number; players: number }[];
}

export interface AdminUser {
  id: string;
  created_at: string;
  last_seen_at: string;
  is_guest: boolean;
  is_admin: boolean;
  identities: { provider: string; subject: string }[];
  caps: number;
  emeralds: number;
  runs_count: number;
  best_time_s: number;
  bosses_killed: string[];
}

export interface AdminRun {
  id: string;
  user_id: string;
  location_id: string;
  hero_id: string;
  speed: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_s: number | null;
  kills: number | null;
  boss_killed: boolean;
  reward_caps: number | null;
  emeralds: number | null;
  flags: string[];
}

export interface AdminUserDetail {
  user: AdminUser;
  upgrades: Record<string, number>;
  unlocks: string[];
  achievements: string[];
  wins: Record<string, Record<string, number>>;
  runs: AdminRun[];
}

export interface AdminAction {
  id: string;
  admin_id: string | null;
  user_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export function adminStats(): Promise<AdminStats> {
  return request<AdminStats>('/admin/stats', {}, true);
}

export function adminUsers(query: string, offset = 0, limit = 50): Promise<{ total: number; users: AdminUser[] }> {
  const params = new URLSearchParams({ q: query, offset: String(offset), limit: String(limit) });
  return request(`/admin/users?${params}`, {}, true);
}

export function adminUser(id: string): Promise<AdminUserDetail> {
  return request<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}`, {}, true);
}

export function adminGrant(id: string, caps: number, emeralds: number, note: string): Promise<AdminUserDetail> {
  return request<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}/grant`, {
    method: 'POST', body: JSON.stringify({ caps, emeralds, note }),
  }, true);
}

export function adminRuns(flagged: boolean): Promise<AdminRun[]> {
  return request<AdminRun[]>(`/admin/runs?flagged=${flagged}&limit=100`, {}, true);
}

export function adminActions(): Promise<AdminAction[]> {
  return request<AdminAction[]>('/admin/actions?limit=100', {}, true);
}

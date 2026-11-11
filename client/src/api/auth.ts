export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: string;
  is_guest: boolean;
}

export interface TelegramStart {
  request_id: string;
  poll_secret: string;
  deep_link: string;
}

export interface TelegramPoll {
  status: 'pending' | 'confirmed' | 'expired';
  tokens: TokenPair | null;
}

const STORAGE_KEY = 'wasteland.auth.v1';
let current: TokenPair | null = null;
let refreshInFlight: Promise<TokenPair | null> | null = null;

function readStored(): TokenPair | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (value && typeof value === 'object' &&
      'access_token' in value && typeof value.access_token === 'string' &&
      'refresh_token' in value && typeof value.refresh_token === 'string' &&
      'user_id' in value && typeof value.user_id === 'string') {
      return value as TokenPair;
    }
  } catch { /* A damaged local session is treated as signed out. */ }
  return null;
}

export function session(): TokenPair | null {
  current ??= readStored();
  return current;
}

export function saveSession(pair: TokenPair): void {
  current = pair;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pair));
}

export function clearSession(): void {
  current = null;
  localStorage.removeItem(STORAGE_KEY);
}

export class ApiRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}, authorized = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (authorized && session()) headers.set('Authorization', `Bearer ${session()!.access_token}`);
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { ...init, headers });
  } catch {
    throw new ApiRequestError(0, 'Сервер недоступен. Проверьте, что запущен make dev.');
  }
  if (response.status === 401 && authorized && session()) {
    const renewed = await restoreSession();
    if (renewed) {
      headers.set('Authorization', `Bearer ${renewed.access_token}`);
      response = await fetch(`/api/v1${path}`, { ...init, headers });
    }
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === 'object' && 'message' in body &&
      typeof body.message === 'string' ? body.message : `Ошибка сервера (${response.status})`;
    throw new ApiRequestError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function restoreSession(): Promise<TokenPair | null> {
  const stored = session();
  if (!stored) return null;
  refreshInFlight ??= (async () => {
    try {
      const pair = await request<TokenPair>('/auth/refresh', {
        method: 'POST', body: JSON.stringify({ refresh_token: stored.refresh_token }),
      });
      saveSession(pair);
      return pair;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) clearSession();
      throw error;
    }
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

export async function createGuest(): Promise<TokenPair> {
  return request<TokenPair>('/auth/guest', { method: 'POST' });
}

export async function startEmail(email: string): Promise<void> {
  await request('/auth/email/start', {
    method: 'POST', body: JSON.stringify({ email }),
  }, Boolean(session()));
}

export async function verifyEmail(body: { token: string } | { email: string; code: string }): Promise<TokenPair> {
  return request<TokenPair>('/auth/email/verify', {
    method: 'POST', body: JSON.stringify(body),
  });
}

export async function startTelegram(): Promise<TelegramStart> {
  return request<TelegramStart>('/auth/telegram/start', { method: 'POST' }, Boolean(session()));
}

export async function pollTelegram(start: TelegramStart): Promise<TelegramPoll> {
  return request<TelegramPoll>(`/auth/telegram/poll/${encodeURIComponent(start.request_id)}`, {
    headers: { 'X-Poll-Secret': start.poll_secret },
  });
}

export async function deleteAccount(): Promise<void> {
  await request<void>('/account', { method: 'DELETE' }, true);
  clearSession();
}

import { describe, expect, it } from 'vitest';
import { clearSession, initSession, saveSession, session, type TokenPair } from '../api/auth';
import { magicTokenFrom } from './links';
import type { TokenStore } from './tokenStore';

function memoryStore(initial: Record<string, string> = {}): TokenStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    get: (key) => Promise.resolve(data[key] ?? null),
    set: (key, value) => { data[key] = value; return Promise.resolve(); },
    remove: (key) => { delete data[key]; return Promise.resolve(); },
  };
}

const pair: TokenPair = {
  access_token: 'access', refresh_token: 'refresh', expires_in: 900, user_id: 'u1', is_guest: true,
};

describe('magic links on Android', () => {
  it('takes the token only from the /login path', () => {
    expect(magicTokenFrom('https://game.example.com/login?token=abc%2B1')).toBe('abc+1');
    expect(magicTokenFrom('https://game.example.com/login/?token=abc')).toBe('abc');
    expect(magicTokenFrom('https://game.example.com/?token=abc')).toBeNull();
    expect(magicTokenFrom('https://game.example.com/login')).toBeNull();
    expect(magicTokenFrom('not a url')).toBeNull();
  });
});

describe('session token store', () => {
  it('restores, saves and clears the session through the platform store', async () => {
    const store = memoryStore({ 'wasteland.auth.v1': JSON.stringify(pair) });
    await initSession(store);
    expect(session()?.user_id).toBe('u1');

    saveSession({ ...pair, user_id: 'u2' });
    await Promise.resolve();
    expect(JSON.parse(store.data['wasteland.auth.v1']!)).toMatchObject({ user_id: 'u2' });

    clearSession();
    await Promise.resolve();
    expect(session()).toBeNull();
    expect(store.data['wasteland.auth.v1']).toBeUndefined();
  });

  it('treats a damaged or unreadable session as signed out', async () => {
    await initSession(memoryStore({ 'wasteland.auth.v1': '{broken' }));
    expect(session()).toBeNull();
    await initSession({ ...memoryStore(), get: () => Promise.reject(new Error('io')) });
    expect(session()).toBeNull();
  });
});

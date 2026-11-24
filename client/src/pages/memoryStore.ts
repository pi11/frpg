import type { TokenStore } from '../platform/tokenStore';

/** Session that lives only on this page and never touches the game's own session. */
export function memoryTokenStore(): TokenStore {
  const data = new Map<string, string>();
  return {
    get: (key) => Promise.resolve(data.get(key) ?? null),
    set: (key, value) => { data.set(key, value); return Promise.resolve(); },
    remove: (key) => { data.delete(key); return Promise.resolve(); },
  };
}

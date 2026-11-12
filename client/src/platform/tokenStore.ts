import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

/** Where the session is kept: Capacitor Preferences on Android, localStorage in the browser. */
export interface TokenStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const browserTokenStore: TokenStore = {
  get: (key) => Promise.resolve(localStorage.getItem(key)),
  set: (key, value) => { localStorage.setItem(key, value); return Promise.resolve(); },
  remove: (key) => { localStorage.removeItem(key); return Promise.resolve(); },
};

export const nativeTokenStore: TokenStore = {
  get: async (key) => (await Preferences.get({ key })).value,
  set: (key, value) => Preferences.set({ key, value }),
  remove: (key) => Preferences.remove({ key }),
};

export function platformTokenStore(): TokenStore {
  return Capacitor.isNativePlatform() ? nativeTokenStore : browserTokenStore;
}

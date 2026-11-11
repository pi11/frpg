export interface Settings {
  music: boolean;
  sfx: boolean;
  crt: boolean;
}

const STORAGE_KEY = 'wasteland.settings.v1';
const defaults: Settings = { music: true, sfx: true, crt: true };
let current: Settings | null = null;
const listeners = new Set<(settings: Settings) => void>();

function read(): Settings {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (value && typeof value === 'object') {
      const stored = value as Partial<Record<keyof Settings, unknown>>;
      return {
        music: typeof stored.music === 'boolean' ? stored.music : defaults.music,
        sfx: typeof stored.sfx === 'boolean' ? stored.sfx : defaults.sfx,
        crt: typeof stored.crt === 'boolean' ? stored.crt : defaults.crt,
      };
    }
  } catch { /* Unavailable or damaged storage falls back to defaults. */ }
  return { ...defaults };
}

export function settings(): Settings {
  current ??= read();
  return current;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...settings(), ...patch };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* not persisted */ }
  for (const listener of listeners) listener(current);
  return current;
}

export function onSettingsChange(listener: (settings: Settings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The CRT overlay is a CSS layer over the canvas (scanlines + vignette). */
export function applyCrt(): void {
  document.body.classList.toggle('crt', settings().crt);
}

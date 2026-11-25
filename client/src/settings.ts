export interface Settings {
  /** Volumes, 0..1. */
  music: number;
  sfx: number;
  crt: boolean;
  /** Let the bought autopilot play. */
  autopilot: boolean;
  /** Tune keys; `auto` in a run means the tune of the location. */
  hubTune: string;
  runTune: string;
}

const STORAGE_KEY = 'wasteland.settings.v1';
const defaults: Settings = { music: 1, sfx: 1, crt: true, autopilot: false, hubTune: 'music/shelter', runTune: 'auto' };
let current: Settings | null = null;
const listeners = new Set<(settings: Settings) => void>();

/** Older versions stored on/off switches here. */
export function volume(value: unknown, fallback: number): number {
  if (typeof value === 'boolean') return value ? fallback : 0;
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function read(): Settings {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (value && typeof value === 'object') {
      const stored = value as Partial<Record<keyof Settings, unknown>>;
      return {
        music: volume(stored.music, defaults.music),
        sfx: volume(stored.sfx, defaults.sfx),
        crt: typeof stored.crt === 'boolean' ? stored.crt : defaults.crt,
        autopilot: typeof stored.autopilot === 'boolean' ? stored.autopilot : defaults.autopilot,
        hubTune: typeof stored.hubTune === 'string' ? stored.hubTune : defaults.hubTune,
        runTune: typeof stored.runTune === 'string' ? stored.runTune : defaults.runTune,
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

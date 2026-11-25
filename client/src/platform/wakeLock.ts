let lock: WakeLockSentinel | null = null;

/** Keeps the screen on while the autopilot plays; browsers without the API just ignore it. */
export async function keepAwake(on: boolean): Promise<void> {
  try {
    if (!on) {
      await lock?.release();
      lock = null;
    } else if (!lock || lock.released) {
      lock = await navigator.wakeLock.request('screen');
    }
  } catch { /* Not supported or the tab is hidden. */ }
}

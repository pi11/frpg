import { isNative } from './native';

/** The whole page goes full screen, so the shelter menus stay visible too. */
export function fullscreenAvailable(): boolean {
  return !isNative && Boolean(document.fullscreenEnabled);
}

export function isFullscreen(): boolean {
  return Boolean(document.fullscreenElement);
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch { /* The browser refused (no user gesture or not allowed): nothing to do. */ }
}

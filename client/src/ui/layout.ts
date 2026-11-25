import type * as Phaser from 'phaser';

export const LANDSCAPE = { width: 480, height: 270 } as const;
const PORTRAIT_WIDTH = 270;
const PORTRAIT_MIN = 460;
const PORTRAIT_MAX = 600;
/** Steps hide small changes such as a browser bar sliding away. */
const PORTRAIT_STEP = 20;

/** Game size for a window: a wide picture, or a tall one when the window is taller than wide. */
export function gameSize(width: number, height: number): { width: number; height: number } {
  if (height <= width) return { ...LANDSCAPE };
  const tall = Math.round(PORTRAIT_WIDTH * height / width / PORTRAIT_STEP) * PORTRAIT_STEP;
  return { width: PORTRAIT_WIDTH, height: Math.min(PORTRAIT_MAX, Math.max(PORTRAIT_MIN, tall)) };
}

export interface Layout { width: number; height: number; portrait: boolean; cx: number; cy: number }

export function layoutOf(scene: Phaser.Scene): Layout {
  const { width, height } = scene.scale;
  return { width, height, portrait: height > width, cx: Math.round(width / 2), cy: Math.round(height / 2) };
}

/** Calls back when the game size really changes (the phone was turned) while the scene lives. */
export function onLayoutChange(scene: Phaser.Scene, callback: () => void): void {
  let { width, height } = scene.scale;
  const check = (): void => {
    if (scene.scale.width === width && scene.scale.height === height) return;
    ({ width, height } = scene.scale);
    callback();
  };
  scene.scale.on('resize', check);
  scene.events.once('shutdown', () => { scene.scale.off('resize', check); });
}

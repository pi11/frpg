import type * as Phaser from 'phaser';
import type { Catalog } from './content/catalog';

/** Atlas built by tools/assets/build_assets.py; frame `<key>` is the static/idle frame. */
export const ATLAS = 'sprites';

/** Interface sounds that are not referenced from content JSON. */
export const UI_SOUNDS = [
  'sfx/enemy_hit', 'sfx/enemy_death', 'sfx/hero_hurt', 'sfx/hero_death', 'sfx/xp_pickup',
  'sfx/level_up', 'sfx/ui_click', 'sfx/ui_buy', 'sfx/ui_error', 'sfx/run_start', 'sfx/reward',
  'sfx/enemy_shot', 'sfx/explosion', 'sfx/warning', 'sfx/crate_break',
] as const;
export const HUB_MUSIC = 'music/shelter';

/** Presentation timing per animation name (frames per second, loop or not). */
const ANIMATION_TIMING: Record<string, { frameRate: number; repeat: number }> = {
  walk: { frameRate: 8, repeat: -1 },
  idle: { frameRate: 6, repeat: -1 },
  death: { frameRate: 10, repeat: 0 },
  burst: { frameRate: 20, repeat: 0 },
  spin: { frameRate: 12, repeat: -1 },
  burn: { frameRate: 10, repeat: -1 },
  break: { frameRate: 14, repeat: 0 },
};

export function animationKey(sprite: string, name: string): string {
  return `${sprite}/${name}`;
}

export function preloadAssets(scene: Phaser.Scene, catalog: Catalog): void {
  scene.load.setPath('assets/');
  scene.load.atlas(ATLAS, 'atlas/sprites.png', 'atlas/sprites.json');
  for (const location of Object.values(catalog.locations)) {
    scene.load.image(location.groundSprite, `${location.groundSprite}.png`);
  }
  const sounds = new Set<string>(UI_SOUNDS);
  for (const weapon of Object.values(catalog.weapons)) sounds.add(weapon.fireSound);
  for (const pickup of Object.values(catalog.pickups)) sounds.add(pickup.sound);
  for (const key of sounds) scene.load.audio(key, `${key}.wav`);
  const music = new Set([HUB_MUSIC, ...Object.values(catalog.locations)
    .flatMap((item) => [item.music, item.bossMusic])]);
  for (const key of music) scene.load.audio(key, [`${key}.ogg`, `${key}.mp3`]);
  scene.load.setPath('');
}

/** Create animations from atlas frame names like `enemies/ghoul/walk_0`. */
export function registerAnimations(scene: Phaser.Scene): void {
  const groups = new Map<string, string[]>();
  for (const frame of scene.textures.get(ATLAS).getFrameNames()) {
    const match = /^(.+)\/([a-z]+)_(\d+)$/.exec(frame);
    if (!match) continue;
    const key = animationKey(match[1]!, match[2]!);
    groups.set(key, [...(groups.get(key) ?? []), frame]);
  }
  for (const [key, frames] of groups) {
    if (scene.anims.exists(key)) continue;
    const timing = ANIMATION_TIMING[key.split('/').at(-1)!] ?? { frameRate: 8, repeat: -1 };
    frames.sort((a, b) => Number(a.split('_').at(-1)) - Number(b.split('_').at(-1)));
    scene.anims.create({
      key, frames: frames.map((frame) => ({ key: ATLAS, frame })), ...timing,
    });
  }
}

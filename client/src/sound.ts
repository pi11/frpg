import type * as Phaser from 'phaser';
import { onSettingsChange, settings } from './settings';

/** Plan: at most three simultaneous instances of the same sound. */
const MAX_INSTANCES = 3;
const SFX_VOLUME = 0.6;
const MUSIC_VOLUME = 0.35;

let manager: Phaser.Sound.BaseSoundManager | null = null;
let music: Phaser.Sound.BaseSound | null = null;
let musicKey: string | null = null;
const playing = new Map<string, number>();

export function initSound(game: Phaser.Game): void {
  manager = game.sound;
  onSettingsChange((value) => {
    if (!value.music) stopMusic();
  });
}

export function playSfx(key: string, volume = 1): void {
  if (!manager || !settings().sfx || !manager.game.cache.audio.exists(key)) return;
  const count = playing.get(key) ?? 0;
  if (count >= MAX_INSTANCES) return;
  const sound = manager.add(key, { volume: SFX_VOLUME * volume });
  playing.set(key, count + 1);
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    playing.set(key, Math.max(0, (playing.get(key) ?? 1) - 1));
    sound.destroy();
  };
  sound.once('complete', release);
  sound.once('stop', release);
  sound.play();
}

export function playMusic(key: string): void {
  if (!manager || !settings().music || !manager.game.cache.audio.exists(key)) return;
  if (musicKey === key && music?.isPlaying) return;
  stopMusic();
  music = manager.add(key, { loop: true, volume: MUSIC_VOLUME });
  musicKey = key;
  music.play();
}

export function stopMusic(): void {
  music?.stop();
  music?.destroy();
  music = null;
  musicKey = null;
}

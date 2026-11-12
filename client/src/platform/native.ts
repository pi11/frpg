import { App } from '@capacitor/app';
import { AppLauncher } from '@capacitor/app-launcher';
import { Capacitor } from '@capacitor/core';
import * as Phaser from 'phaser';
import type { HudScene } from '../scenes/HudScene';
import { magicTokenFrom } from './links';

export const isNative = Capacitor.isNativePlatform();

let launchToken: string | null = null;

/** Token of the magic link that cold-started the app; returned once. */
export function takeLaunchToken(): string | null {
  const token = launchToken;
  launchToken = null;
  return token;
}

/** Opens Telegram (or any external link) in its own app instead of the game WebView. */
export async function openExternal(url: string): Promise<void> {
  if (isNative) await AppLauncher.openUrl({ url });
  else window.open(url, '_blank', 'noopener,noreferrer');
}

function hud(game: Phaser.Game): HudScene | null {
  const manager = game.scene;
  const running = manager.isActive('Run') || manager.isPaused('Run');
  return running && manager.isActive('Hud') ? manager.getScene('Hud') as HudScene : null;
}

/** Shows the pause panel if a run is going; never resumes. */
export function pauseRun(game: Phaser.Game): void {
  hud(game)?.pause();
}

function handleBack(game: Phaser.Game): void {
  const manager = game.scene;
  if (manager.isActive('LevelUp') || manager.isActive('Chest') || manager.isActive('Result')) return;
  const runHud = hud(game);
  if (runHud) {
    runHud.togglePause();
    return;
  }
  if (manager.isActive('Hub') || manager.isActive('Auth')) {
    if (window.confirm('Выйти из игры?')) void App.exitApp();
  }
}

function openMagicLink(game: Phaser.Game, token: string): void {
  for (const scene of game.scene.getScenes(false)) {
    if (scene.scene.key !== 'Auth') scene.scene.stop();
  }
  game.scene.stop('Auth');
  game.scene.start('Auth', { token });
}

/** Must run before the game starts so a cold-start magic link reaches the Auth scene. */
export async function preparePlatform(): Promise<void> {
  if (!isNative) return;
  const launch = await App.getLaunchUrl().catch(() => undefined);
  launchToken = launch ? magicTokenFrom(launch.url) : null;
}

export function setupPlatform(game: Phaser.Game): void {
  // Leaving the tab or app pauses the run; Phaser already pauses its loop and sounds.
  game.events.on(Phaser.Core.Events.HIDDEN, () => pauseRun(game));
  if (!isNative) return;
  void App.addListener('pause', () => {
    pauseRun(game);
    game.sound.mute = true;
  });
  void App.addListener('resume', () => { game.sound.mute = false; });
  void App.addListener('backButton', () => handleBack(game));
  void App.addListener('appUrlOpen', ({ url }) => {
    const token = magicTokenFrom(url);
    if (token) openMagicLink(game, token);
  });
}

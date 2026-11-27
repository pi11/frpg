import '@fontsource/press-start-2p/cyrillic-400.css';
import '@fontsource/press-start-2p/latin-400.css';
import * as Phaser from 'phaser';
import { AdminScene } from './scenes/AdminScene';
import { AuthScene } from './scenes/AuthScene';
import { BootScene } from './scenes/BootScene';
import { ChestScene } from './scenes/ChestScene';
import { HubScene } from './scenes/HubScene';
import { HudScene } from './scenes/HudScene';
import { LevelUpScene } from './scenes/LevelUpScene';
import { ResultScene } from './scenes/ResultScene';
import { RunScene } from './scenes/RunScene';
import { initSession } from './api/auth';
import { platformTokenStore } from './platform/tokenStore';
import { preparePlatform, setupPlatform } from './platform/native';
import { gameSize } from './ui/layout';
import './style.css';

await Promise.all([initSession(platformTokenStore()), preparePlatform()]);

/** The room left for the game inside the safe-area padding (camera cutout, gesture bar). */
function areaSize(): { width: number; height: number } {
  const area = document.getElementById('game-area');
  return gameSize(area?.clientWidth || window.innerWidth, area?.clientHeight || window.innerHeight);
}

export const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-area',
  ...areaSize(),
  backgroundColor: '#08120b',
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
  },
  scene: [AuthScene, BootScene, HubScene, AdminScene, RunScene, HudScene, LevelUpScene, ChestScene, ResultScene],
});

setupPlatform(game);

function fitGame(): void {
  const { width, height } = areaSize();
  if (width !== game.scale.width || height !== game.scale.height) game.scale.setGameSize(width, height);
  // Entering full screen changes the safe-area padding without always resizing the window.
  game.scale.refresh();
}
window.addEventListener('resize', fitGame);
document.addEventListener('fullscreenchange', () => requestAnimationFrame(fitGame));
new ResizeObserver(fitGame).observe(document.getElementById('game-area')!);

if (import.meta.env.DEV) {
  (window as Window & { __wastelandGame?: Phaser.Game }).__wastelandGame = game;
}

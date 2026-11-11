import * as Phaser from 'phaser';
import { AuthScene } from './scenes/AuthScene';
import { BootScene } from './scenes/BootScene';
import { HudScene } from './scenes/HudScene';
import { LevelUpScene } from './scenes/LevelUpScene';
import { ResultScene } from './scenes/ResultScene';
import { RunScene } from './scenes/RunScene';
import './style.css';

export const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 480,
  height: 270,
  backgroundColor: '#17211c',
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
  scene: [AuthScene, BootScene, RunScene, HudScene, LevelUpScene, ResultScene],
});

if (import.meta.env.DEV) {
  (window as Window & { __wastelandGame?: Phaser.Game }).__wastelandGame = game;
}

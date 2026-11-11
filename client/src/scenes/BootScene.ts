import * as Phaser from 'phaser';
import { createPlaceholderTextures } from './textures';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    createPlaceholderTextures(this);
    this.add.text(240, 90, 'ПУСТОШЬ', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#99c78e',
    }).setOrigin(0.5);
    this.add.text(240, 137, 'Нажми, чтобы выйти из убежища', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#c6b791',
    }).setOrigin(0.5);
    this.add.text(240, 165, 'WASD / стрелки · мышь / тач · P — пауза', {
      fontFamily: 'monospace', fontSize: '9px', color: '#7d9782',
    }).setOrigin(0.5);

    const start = (): void => {
      this.scene.start('Run', { seed: Date.now() >>> 0 });
    };
    this.input.once('pointerdown', start);
    this.input.keyboard?.once('keydown-SPACE', start);
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('autostart')) start();
  }
}

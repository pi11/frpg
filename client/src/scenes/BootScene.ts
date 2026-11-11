import * as Phaser from 'phaser';
import { getCatalog } from '../content/catalog';
import { createPlaceholderTextures } from './textures';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    let locationId: string;
    let heroId: string;
    try {
      const location = Object.values(getCatalog().locations)[0];
      if (!location) throw new Error('Нет локации');
      locationId = location.id;
      heroId = location.startingHero;
    } catch (error) {
      this.add.text(12, 30, `Ошибка контента: ${String(error)}`, {
        fontFamily: 'monospace', fontSize: '12px', color: '#ff8877',
        wordWrap: { width: 456 },
      });
      return;
    }
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
      const params = new URLSearchParams(window.location.search);
      const seedParam = params.get('seed');
      const waveParam = params.get('wave');
      const parsedSeed = seedParam === null ? NaN : Number(seedParam);
      const parsedWave = waveParam === null ? NaN : Number(waveParam);
      const seed = Number.isSafeInteger(parsedSeed) && parsedSeed >= 0
        ? parsedSeed >>> 0 : Date.now() >>> 0;
      const wave = Number.isSafeInteger(parsedWave) && parsedWave >= 0 ? parsedWave : 0;
      this.scene.start('Run', { seed, locationId, heroId, wave });
    };
    this.input.once('pointerdown', start);
    this.input.keyboard?.once('keydown-SPACE', start);
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('autostart')) start();
  }
}

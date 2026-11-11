import * as Phaser from 'phaser';
import { getCatalog } from '../content/catalog';
import { createPlaceholderTextures } from './textures';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    try {
      if (!Object.values(getCatalog().locations)[0]) throw new Error('Нет локации');
    } catch (error) {
      this.add.text(12, 30, `Ошибка контента: ${String(error)}`, {
        fontFamily: 'monospace', fontSize: '12px', color: '#ff8877',
        wordWrap: { width: 456 },
      });
      return;
    }
    createPlaceholderTextures(this);
    this.scene.start('Hub');
  }
}

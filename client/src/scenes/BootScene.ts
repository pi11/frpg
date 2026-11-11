import * as Phaser from 'phaser';
import { preloadAssets, registerAnimations } from '../assets';
import { getCatalog } from '../content/catalog';
import { applyCrt } from '../settings';
import { initSound } from '../sound';
import { COLORS, FONT } from '../ui/theme';

/** Validates content, loads the atlas, audio and pixel font, then opens the shelter. */
export class BootScene extends Phaser.Scene {
  private contentError: string | null = null;

  constructor() {
    super('Boot');
  }

  preload(): void {
    applyCrt();
    let catalog;
    try {
      catalog = getCatalog();
      if (!Object.values(catalog.locations)[0]) throw new Error('Нет локации');
    } catch (error) {
      this.contentError = String(error);
      return;
    }
    const bar = this.add.graphics();
    this.add.text(240, 120, 'ЗАГРУЗКА…', {
      fontFamily: 'monospace', fontSize: '10px', color: COLORS.text,
    }).setOrigin(0.5);
    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      bar.clear().fillStyle(COLORS.barBack).fillRect(140, 134, 200, 6)
        .fillStyle(COLORS.xp).fillRect(140, 134, 200 * value, 6);
    });
    preloadAssets(this, catalog);
  }

  create(): void {
    if (this.contentError) {
      this.add.text(12, 30, `Ошибка контента: ${this.contentError}`, {
        fontFamily: 'monospace', fontSize: '12px', color: COLORS.danger,
        wordWrap: { width: 456 },
      });
      return;
    }
    registerAnimations(this);
    initSound(this.game);
    void document.fonts.load(`8px ${FONT}`, 'АБВ abc 123')
      .catch(() => undefined)
      .then(() => this.scene.start('Hub'));
  }
}

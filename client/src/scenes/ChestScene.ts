import * as Phaser from 'phaser';
import { ATLAS } from '../assets';
import { playSfx } from '../sound';
import { COLORS, textStyle } from '../ui/theme';
import { RunScene } from './RunScene';

/** Shows what a mini-boss chest granted; the upgrades are already applied. */
export class ChestScene extends Phaser.Scene {
  private closing = false;

  constructor() {
    super('Chest');
  }

  create(): void {
    this.closing = false;
    const { granted, caps } = (this.scene.get('Run') as RunScene).chest;
    this.add.rectangle(240, 135, 480, 270, 0x030805, 0.88);
    this.add.image(240, 42, ATLAS, 'pickups/chest').setScale(2);
    this.add.text(240, 66, 'СУНДУК', textStyle(16, COLORS.warn)).setOrigin(0.5);
    const rows = granted.length ? granted : [];
    const top = 140 - rows.length * 17;
    rows.forEach((choice, index) => {
      const y = top + index * 34;
      const evolution = choice.kind === 'evolution';
      this.add.rectangle(240, y, 300, 30, COLORS.panel, 0.95)
        .setStrokeStyle(evolution ? 2 : 1, evolution ? COLORS.evolution : COLORS.panelBorder);
      this.add.image(108, y, ATLAS, choice.sprite);
      const title = evolution ? `ЭВОЛЮЦИЯ: ${choice.name.toUpperCase()}` : choice.name.toUpperCase();
      this.add.text(124, y - 8, title, textStyle(8, evolution ? COLORS.warn : COLORS.bright));
      this.add.text(124, y + 3, choice.description, textStyle(8, COLORS.dim));
    });
    if (!rows.length) {
      this.add.text(240, 130, 'ВСЁ УЖЕ НА МАКСИМУМЕ', textStyle(8, COLORS.dim)).setOrigin(0.5);
    }
    this.add.image(214, 216, ATLAS, 'ui/cap');
    this.add.text(226, 212, `+${caps} КРЫШЕК`, textStyle(8, COLORS.warn));
    this.add.text(240, 246, 'ПРОБЕЛ ИЛИ КАСАНИЕ — ДАЛЬШЕ', textStyle(8, COLORS.dim)).setOrigin(0.5);
    playSfx('sfx/level_up');
    // A short delay so the click that killed the boss does not close the chest at once.
    this.time.delayedCall(400, () => {
      this.input.once('pointerdown', () => this.close());
      this.input.keyboard?.once('keydown-SPACE', () => this.close());
    });
  }

  private close(): void {
    if (this.closing) return;
    this.closing = true;
    playSfx('sfx/ui_click');
    this.scene.resume('Run');
    this.scene.stop();
  }
}

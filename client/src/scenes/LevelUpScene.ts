import * as Phaser from 'phaser';
import { ATLAS } from '../assets';
import { playSfx } from '../sound';
import { COLORS, textStyle } from '../ui/theme';
import { RunScene } from './RunScene';
import type { UpgradeChoice } from './RunScene';

export class LevelUpScene extends Phaser.Scene {
  constructor() {
    super('LevelUp');
  }

  create(): void {
    const choices = (this.scene.get('Run') as RunScene).choices;
    this.add.rectangle(240, 135, 480, 270, 0x030805, 0.86);
    this.add.text(240, 34, 'НОВЫЙ УРОВЕНЬ', textStyle(16, COLORS.bright)).setOrigin(0.5);
    this.add.text(240, 54, 'ВЫБЕРИ УЛУЧШЕНИЕ: 1–3 ИЛИ КАСАНИЕ', textStyle(8, COLORS.dim)).setOrigin(0.5);

    choices.forEach((upgrade, index) => {
      const x = 84 + index * 156;
      const evolution = upgrade.kind === 'evolution';
      const border = evolution ? COLORS.evolution : COLORS.panelBorder;
      const card = this.add.rectangle(x, 150, 144, 140, COLORS.panel, 0.95)
        .setStrokeStyle(evolution ? 2 : 1, border).setInteractive({ useHandCursor: true });
      card.on('pointerover', () => card.setStrokeStyle(2, evolution ? 0xfff0b8 : 0x9bff6e));
      card.on('pointerout', () => card.setStrokeStyle(evolution ? 2 : 1, border));
      card.on('pointerdown', () => this.choose(upgrade));
      this.add.text(x - 64, 86, `[${index + 1}]`, textStyle(8, COLORS.dim));
      if (evolution) {
        const badge = this.add.text(x + 66, 86, 'ЭВОЛЮЦИЯ', textStyle(8, COLORS.warn)).setOrigin(1, 0);
        this.tweens.add({ targets: badge, alpha: 0.35, duration: 420, yoyo: true, repeat: -1 });
      }
      this.add.image(x, 108, ATLAS, upgrade.sprite).setScale(2);
      this.add.text(x, 138, upgrade.name.toUpperCase(), textStyle(8, evolution ? COLORS.warn : COLORS.bright, {
        align: 'center', wordWrap: { width: 132 },
      })).setOrigin(0.5, 0);
      this.add.text(x, 176, upgrade.description, textStyle(8, COLORS.text, {
        align: 'center', wordWrap: { width: 132 },
      })).setOrigin(0.5, 0);
    });
    const onKey = (event: KeyboardEvent): void => {
      const index = Number(event.key) - 1;
      const choice = choices[index];
      if (choice) this.choose(choice);
    };
    this.input.keyboard?.on('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown', onKey);
    });
  }

  private choose(choice: UpgradeChoice): void {
    playSfx('sfx/ui_click');
    (this.scene.get('Run') as RunScene).applyUpgrade(choice);
    this.scene.resume('Run');
    this.scene.stop();
  }
}

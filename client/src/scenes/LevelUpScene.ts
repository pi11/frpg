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
    const run = this.scene.get('Run') as RunScene;
    const { choices } = run;
    this.add.rectangle(240, 135, 480, 270, 0x030805, 0.86);
    this.add.text(240, 24, 'НОВЫЙ УРОВЕНЬ', textStyle(16, COLORS.bright)).setOrigin(0.5);
    this.add.text(240, 42, 'ВЫБЕРИ УЛУЧШЕНИЕ: 1–3 ИЛИ КАСАНИЕ', textStyle(8, COLORS.dim)).setOrigin(0.5);

    choices.forEach((upgrade, index) => {
      const x = 84 + index * 156;
      const evolution = upgrade.kind === 'evolution';
      const border = evolution ? COLORS.evolution : COLORS.panelBorder;
      const card = this.add.rectangle(x, 130, 144, 156, COLORS.panel, 0.95)
        .setStrokeStyle(evolution ? 2 : 1, border).setInteractive({ useHandCursor: true });
      card.on('pointerover', () => card.setStrokeStyle(2, evolution ? 0xfff0b8 : 0x9bff6e));
      card.on('pointerout', () => card.setStrokeStyle(evolution ? 2 : 1, border));
      card.on('pointerdown', () => this.choose(upgrade));
      upgrade.pairs.slice(0, 3).forEach((sprite, pair) => {
        this.add.text(x + 38 - pair * 22, 66, '+', textStyle(8, COLORS.warn));
        this.add.image(x + 56 - pair * 22, 70, ATLAS, sprite);
      });
      this.add.text(x - 64, 58, `[${index + 1}]`, textStyle(8, COLORS.dim));
      if (evolution) {
        const badge = this.add.text(x + 66, 58, 'ЭВОЛЮЦИЯ', textStyle(8, COLORS.warn)).setOrigin(1, 0);
        this.tweens.add({ targets: badge, alpha: 0.35, duration: 420, yoyo: true, repeat: -1 });
      }
      this.add.image(x, 84, ATLAS, upgrade.sprite).setScale(2);
      this.add.text(x, 106, upgrade.name.toUpperCase(), textStyle(8, evolution ? COLORS.warn : COLORS.bright, {
        align: 'center', wordWrap: { width: 132 },
      })).setOrigin(0.5, 0);
      this.add.text(x, 134, upgrade.description, textStyle(8, COLORS.text, {
        align: 'center', wordWrap: { width: 132 },
      })).setOrigin(0.5, 0);
    });
    const { weapons, passives } = run.loadout();
    [weapons, passives].forEach((items, row) => items.forEach((item, index) => {
      const x = 14 + index * 34;
      const y = 226 + row * 22;
      this.add.image(x, y, ATLAS, item.sprite);
      this.add.text(x + 9, y - 2, item.level >= item.max ? '*' : String(item.level),
        textStyle(8, item.level >= item.max ? COLORS.warn : COLORS.dim));
    }));
    if (run.view.rerolls > 0) {
      const button = this.add.text(466, 237, `[R] ПЕРЕБРОСИТЬ · ${run.view.rerolls}`,
        textStyle(8, COLORS.bright, { backgroundColor: '#1d3322', padding: { x: 8, y: 8 } }))
        .setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
      button.on('pointerdown', () => this.reroll());
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === 'KeyR') {
        this.reroll();
        return;
      }
      const index = Number(event.key) - 1;
      const choice = choices[index];
      if (choice) this.choose(choice);
    };
    this.input.keyboard?.on('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown', onKey);
    });
  }

  private reroll(): void {
    if (!(this.scene.get('Run') as RunScene).reroll()) return;
    playSfx('sfx/ui_buy');
    this.scene.restart();
  }

  private choose(choice: UpgradeChoice): void {
    playSfx('sfx/ui_click');
    (this.scene.get('Run') as RunScene).applyUpgrade(choice);
    this.scene.resume('Run');
    this.scene.stop();
  }
}

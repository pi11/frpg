import * as Phaser from 'phaser';
import { RunScene } from './RunScene';
import type { UpgradeChoice } from './RunScene';

export class LevelUpScene extends Phaser.Scene {
  constructor() {
    super('LevelUp');
  }

  create(): void {
    const choices = (this.scene.get('Run') as RunScene).choices;
    this.add.rectangle(240, 135, 480, 270, 0x07100c, 0.9);
    this.add.text(240, 27, 'НОВЫЙ УРОВЕНЬ — ВЫБЕРИ УЛУЧШЕНИЕ', {
      fontFamily: 'monospace', fontSize: '14px', color: '#9acb9b',
    }).setOrigin(0.5);

    choices.forEach((upgrade, index) => {
      const x = 82 + index * 158;
      const card = this.add.rectangle(x, 138, 146, 160, 0x25352a)
        .setStrokeStyle(2, 0x86ad83).setInteractive({ useHandCursor: true });
      card.on('pointerdown', () => this.choose(upgrade));
      this.add.text(x, 91, `${index + 1}. ${upgrade.name}`, {
        fontFamily: 'monospace', fontSize: '11px', color: '#e4dcba',
        align: 'center', wordWrap: { width: 130 },
      }).setOrigin(0.5);
      this.add.text(x, 157, upgrade.description, {
        fontFamily: 'monospace', fontSize: '10px', color: '#9acb9b',
        align: 'center', wordWrap: { width: 130 },
      }).setOrigin(0.5);
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
    (this.scene.get('Run') as RunScene).applyUpgrade(choice);
    this.scene.resume('Run');
    this.scene.stop();
  }
}

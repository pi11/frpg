import * as Phaser from 'phaser';
import { ATLAS } from '../assets';
import { autopilotChoice } from '../systems/autopilot';
import { playSfx } from '../sound';
import { Tooltip } from '../ui/Tooltip';
import { layoutOf, onLayoutChange } from '../ui/layout';
import { COLORS, textStyle } from '../ui/theme';
import { RunScene } from './RunScene';
import type { UpgradeChoice } from './RunScene';

/** Height of a card on an upright phone (presentation). */
const CARD_HEIGHT = 96;

export class LevelUpScene extends Phaser.Scene {
  private countdown!: Phaser.Time.TimerEvent;
  private countdownBar!: Phaser.GameObjects.Rectangle;

  constructor() {
    super('LevelUp');
  }

  create(): void {
    const run = this.scene.get('Run') as RunScene;
    const { choices } = run;
    const { cx, cy, width, height, portrait } = layoutOf(this);
    this.add.rectangle(cx, cy, width, height, 0x030805, 0.86);
    this.add.text(cx, portrait ? 30 : 24, 'НОВЫЙ УРОВЕНЬ', textStyle(16, COLORS.bright)).setOrigin(0.5);
    this.add.text(cx, portrait ? 52 : 42, portrait ? 'КОСНИТЕСЬ КАРТОЧКИ' : 'ВЫБЕРИ УЛУЧШЕНИЕ: 1–3 ИЛИ КАСАНИЕ',
      textStyle(8, COLORS.dim)).setOrigin(0.5);
    choices.forEach((upgrade, index) => {
      if (portrait) this.tallCard(upgrade, index, width);
      else this.wideCard(upgrade, index);
    });
    const { weapons, heavy, passives } = run.loadout();
    const tooltip = new Tooltip(this);
    const rows = portrait ? 66 + CARD_HEIGHT * 3 + 34 : 226;
    [[...weapons, ...heavy], passives].forEach((items, row) => items.forEach((item, index) => {
      const x = 14 + index * (portrait ? 32 : 34);
      const y = rows + row * 22;
      this.add.image(x, y, ATLAS, item.sprite).setInteractive()
        .on('pointerover', (pointer: Phaser.Input.Pointer) => {
          if (!pointer.wasTouch) tooltip.show({ x, y }, item.name, item.details);
        }).on('pointerout', () => tooltip.hide());
      this.add.text(x + 9, y - 2, item.level >= item.max ? '*' : String(item.level),
        textStyle(8, item.level >= item.max ? COLORS.warn : COLORS.dim));
    }));
    if (run.view.rerolls > 0) {
      const button = this.add.text(portrait ? cx : 466, portrait ? height - 24 : 237,
        `${portrait ? '' : '[R] '}ПЕРЕБРОСИТЬ · ${run.view.rerolls}`,
        textStyle(8, COLORS.bright, { backgroundColor: '#1d3322', padding: { x: 8, y: 8 } }))
        .setOrigin(portrait ? 0.5 : 1, 0.5).setInteractive({ useHandCursor: true });
      button.on('pointerdown', () => this.reroll());
    }
    this.countdown = this.time.delayedCall(run.levelUpTimeoutMs, () => {
      const choice = run.randomChoice();
      if (choice) this.choose(choice);
    });
    this.countdownBar = this.add.rectangle(0, 0, width, 3, COLORS.xp).setOrigin(0);
    onLayoutChange(this, () => this.scene.restart());
    if (run.autopilotOn) {
      const choice = autopilotChoice(choices);
      // Long enough to see the cards; a player may still click another one.
      if (choice) this.time.delayedCall(900, () => this.choose(choice));
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

  update(): void {
    const left = 1 - this.countdown.getProgress();
    this.countdownBar.setScale(left, 1).setFillStyle(left < 0.3 ? COLORS.hp : COLORS.xp);
  }

  private card(upgrade: UpgradeChoice, x: number, y: number, width: number, height: number): boolean {
    const evolution = upgrade.kind === 'evolution';
    const border = evolution ? COLORS.evolution : COLORS.panelBorder;
    const card = this.add.rectangle(x, y, width, height, COLORS.panel, 0.95)
      .setStrokeStyle(evolution ? 2 : 1, border).setInteractive({ useHandCursor: true });
    card.on('pointerover', () => card.setStrokeStyle(2, evolution ? 0xfff0b8 : 0x9bff6e));
    card.on('pointerout', () => card.setStrokeStyle(evolution ? 2 : 1, border));
    card.on('pointerdown', () => this.choose(upgrade));
    return evolution;
  }

  private evolutionBadge(right: number, top: number): void {
    const badge = this.add.text(right, top, 'ЭВОЛЮЦИЯ', textStyle(8, COLORS.warn)).setOrigin(1, 0);
    this.tweens.add({ targets: badge, alpha: 0.35, duration: 420, yoyo: true, repeat: -1 });
  }

  private pairs(upgrade: UpgradeChoice, right: number, y: number): void {
    upgrade.pairs.slice(0, 3).forEach((sprite, pair) => {
      this.add.text(right - 18 - pair * 22, y - 4, '+', textStyle(8, COLORS.warn));
      this.add.image(right - pair * 22, y, ATLAS, sprite);
    });
  }

  private wideCard(upgrade: UpgradeChoice, index: number): void {
    const x = 84 + index * 156;
    const evolution = this.card(upgrade, x, 130, 144, 156);
    this.pairs(upgrade, x + 56, 70);
    this.add.text(x - 64, 58, `[${index + 1}]`, textStyle(8, COLORS.dim));
    if (evolution) this.evolutionBadge(x + 66, 58);
    this.add.image(x, 84, ATLAS, upgrade.sprite).setScale(2);
    const wordWrap = { width: 132 };
    this.add.text(x, 106, upgrade.name.toUpperCase(),
      textStyle(8, evolution ? COLORS.warn : COLORS.bright, { align: 'center', wordWrap })).setOrigin(0.5, 0);
    this.add.text(x, 134, upgrade.description, textStyle(8, COLORS.text, { align: 'center', wordWrap }))
      .setOrigin(0.5, 0);
  }

  /** Upright phone: cards one under another, icon on the left. */
  private tallCard(upgrade: UpgradeChoice, index: number, width: number): void {
    const top = 66 + index * (CARD_HEIGHT + 6);
    const evolution = this.card(upgrade, width / 2, top + CARD_HEIGHT / 2, width - 16, CARD_HEIGHT);
    this.add.image(34, top + 34, ATLAS, upgrade.sprite).setScale(2);
    this.pairs(upgrade, 40, top + CARD_HEIGHT - 16);
    if (evolution) this.evolutionBadge(width - 14, top + CARD_HEIGHT - 14);
    const wordWrap = { width: width - 80 };
    const name = this.add.text(62, top + 8, upgrade.name.toUpperCase(),
      textStyle(8, evolution ? COLORS.warn : COLORS.bright, { wordWrap }));
    this.add.text(62, top + 14 + name.height, upgrade.description, textStyle(8, COLORS.text, { wordWrap }));
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

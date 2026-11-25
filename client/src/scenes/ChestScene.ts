import * as Phaser from 'phaser';
import { animationKey, ATLAS } from '../assets';
import { getCatalog } from '../content/catalog';
import { playSfx } from '../sound';
import { COLORS, textStyle } from '../ui/theme';
import { RunScene, type UpgradeChoice } from './RunScene';

const TEXT_WIDTH = 396;
const ROW_GAP = 4;
const SHAKES = 3;
const SHAKE_MS = 260;
/** Each reel starts after the previous one stopped and slows down before stopping. */
const REEL_STEPS = 10;
const REEL_FIRST_STEP_MS = 45;
const REEL_SLOWDOWN = 1.14;

interface Row {
  choice: UpgradeChoice;
  frame: Phaser.GameObjects.Rectangle;
  icon: Phaser.GameObjects.Image;
  texts: Phaser.GameObjects.Text[];
  revealed: boolean;
}

/**
 * Plays the opening of a mini-boss chest: the chest shakes, bursts open and reels stop on the
 * upgrades one by one. The rewards were rolled and applied by RunScene before this scene starts.
 */
export class ChestScene extends Phaser.Scene {
  private rows: Row[] = [];
  private caps = 0;
  private chest!: Phaser.GameObjects.Sprite;
  private glow!: Phaser.GameObjects.Sprite;
  private hint!: Phaser.GameObjects.Text;
  private footer: (Phaser.GameObjects.Image | Phaser.GameObjects.Text)[] = [];
  private opened = false;
  private done = false;
  private closing = false;

  constructor() {
    super('Chest');
  }

  create(): void {
    this.opened = false;
    this.done = false;
    this.closing = false;
    const { granted, caps } = (this.scene.get('Run') as RunScene).chest;
    this.caps = caps;
    this.add.rectangle(240, 135, 480, 270, 0x030805, 0.88);
    this.glow = this.add.sprite(240, 135, ATLAS, 'fx/ray').setScale(3).setAlpha(0);
    this.glow.play(animationKey('fx/ray', 'idle'));
    this.chest = this.add.sprite(240, 135, ATLAS, 'pickups/chest').setScale(5);
    this.buildRows(granted);
    this.footer = [
      this.add.image(214, 222, ATLAS, 'ui/cap').setVisible(false),
      this.add.text(226, 218, `+${caps} КРЫШЕК`, textStyle(8, COLORS.warn)).setVisible(false),
    ];
    if (!granted.length) {
      this.footer.push(this.add.text(240, 130, 'ВСЁ УЖЕ НА МАКСИМУМЕ', textStyle(8, COLORS.dim))
        .setOrigin(0.5).setVisible(false));
    }
    this.hint = this.add.text(240, 250, 'ПРОБЕЛ ИЛИ КАСАНИЕ — ПРОПУСТИТЬ', textStyle(8, COLORS.dim))
      .setOrigin(0.5).setVisible(false);

    // A short delay so the click that picked the chest up does not skip it at once.
    this.time.delayedCall(400, () => {
      this.hint.setVisible(true);
      this.input.on('pointerdown', () => this.advance());
      this.input.keyboard?.on('keydown-SPACE', (event: KeyboardEvent) => {
        if (!event.repeat) this.advance();
      });
    });
    for (let index = 0; index < SHAKES; index += 1) {
      this.time.delayedCall(index * SHAKE_MS, () => this.shake());
    }
    this.time.delayedCall(SHAKES * SHAKE_MS, () => this.open());
  }

  /** Hidden result rows, sized by their text and centred between the chest and the caps line. */
  private buildRows(granted: UpgradeChoice[]): void {
    const sized = granted.map((choice) => {
      const evolution = choice.kind === 'evolution';
      const title = evolution ? `ЭВОЛЮЦИЯ: ${choice.name.toUpperCase()}` : choice.name.toUpperCase();
      const wordWrap = { width: TEXT_WIDTH };
      const name = this.add.text(52, 0, title,
        textStyle(8, evolution ? COLORS.warn : COLORS.bright, { wordWrap })).setDepth(2).setVisible(false);
      const text = this.add.text(52, 0, choice.description.replaceAll('\n', ' · '),
        textStyle(8, COLORS.dim, { wordWrap })).setDepth(2).setVisible(false);
      return { choice, evolution, name, text, height: name.height + text.height + 12 };
    });
    const total = sized.reduce((sum, row) => sum + row.height + ROW_GAP, -ROW_GAP);
    let y = Math.max(78, 142 - total / 2);
    this.rows = sized.map(({ choice, evolution, name, text, height }) => {
      const frame = this.add.rectangle(240, y + height / 2, 432, height, COLORS.panel, 0.95)
        .setStrokeStyle(evolution ? 2 : 1, evolution ? COLORS.evolution : COLORS.panelBorder)
        .setDepth(1).setVisible(false);
      const icon = this.add.image(38, y + height / 2, ATLAS, choice.sprite).setDepth(2).setVisible(false);
      name.setY(Math.round(y + 5));
      text.setY(Math.round(y + 7 + name.height));
      y += height + ROW_GAP;
      return { choice, frame, icon, texts: [name, text], revealed: false };
    });
  }

  private shake(): void {
    if (this.opened) return;
    playSfx('sfx/chest_shake');
    this.tweens.add({ targets: this.chest, angle: { from: -9, to: 9 }, duration: 45, yoyo: true,
      repeat: 1, onComplete: () => this.chest.setAngle(0) });
  }

  private open(): void {
    if (this.opened) return;
    this.opened = true;
    playSfx('sfx/chest');
    this.cameras.main.flash(180, 255, 230, 150);
    this.glow.setAlpha(0.9);
    this.burst(240, 135, 24);
    this.tweens.add({ targets: this.chest, y: 42, scale: 2, duration: 260, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: this.glow, y: 42, scale: 1.4, alpha: 0.6, duration: 260 });
    this.add.text(240, 66, 'СУНДУК', textStyle(16, COLORS.warn)).setOrigin(0.5);
    this.time.delayedCall(320, () => this.spin(0));
  }

  /** Rolls icons of every item through the row, then stops on the granted one. */
  private spin(index: number): void {
    if (this.done) return;
    const row = this.rows[index];
    if (!row) {
      this.finish();
      return;
    }
    const { weapons, passives } = getCatalog();
    const sprites = [...Object.values(weapons), ...Object.values(passives)].map((item) => item.sprite);
    row.frame.setVisible(true);
    row.icon.setVisible(true);
    let wait = REEL_FIRST_STEP_MS;
    const step = (count: number): void => {
      if (row.revealed || this.done) return;
      if (count >= REEL_STEPS) {
        this.reveal(row);
        this.time.delayedCall(350, () => this.spin(index + 1));
        return;
      }
      row.icon.setFrame(Phaser.Utils.Array.GetRandom(sprites));
      playSfx('sfx/chest_tick');
      wait *= REEL_SLOWDOWN;
      this.time.delayedCall(wait, () => step(count + 1));
    };
    step(0);
  }

  private reveal(row: Row): void {
    if (row.revealed) return;
    row.revealed = true;
    row.frame.setVisible(true);
    row.icon.setVisible(true).setFrame(row.choice.sprite);
    for (const text of row.texts) text.setVisible(true);
    playSfx(row.choice.kind === 'evolution' ? 'sfx/powerup' : 'sfx/chest_reveal');
    this.burst(row.icon.x, row.icon.y, 10);
    row.frame.setFillStyle(0xf2c46b, 0.6);
    this.time.delayedCall(120, () => row.frame.setFillStyle(COLORS.panel, 0.95));
    this.tweens.add({ targets: row.icon, scale: { from: 2.2, to: 1 }, duration: 220, ease: 'Back.easeOut' });
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    for (const part of this.footer) part.setVisible(true);
    playSfx(this.rows.length >= 3 ? 'sfx/chest_jackpot' : this.caps ? 'sfx/cap' : 'sfx/ui_click');
    this.hint.setText('ПРОБЕЛ ИЛИ КАСАНИЕ — ДАЛЬШЕ');
  }

  /** First press shows everything at once, the next one closes the chest. */
  private advance(): void {
    if (this.done) {
      this.close();
      return;
    }
    this.open();
    for (const row of this.rows) this.reveal(row);
    this.finish();
  }

  private burst(x: number, y: number, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const spark = this.add.rectangle(x, y, 3, 3, index % 2 ? 0xecc962 : 0xf0e8cf).setDepth(3);
      const reach = 24 + (index % 4) * 14;
      this.tweens.add({ targets: spark, x: x + Math.cos(angle) * reach, y: y + Math.sin(angle) * reach,
        alpha: 0, duration: 450, ease: 'Cubic.easeOut', onComplete: () => spark.destroy() });
    }
  }

  private close(): void {
    if (this.closing) return;
    this.closing = true;
    playSfx('sfx/ui_click');
    this.scene.resume('Run');
    this.scene.stop();
  }
}

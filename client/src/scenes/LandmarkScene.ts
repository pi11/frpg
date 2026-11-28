import * as Phaser from 'phaser';
import { playSfx } from '../sound';
import type { ChoiceCard } from '../systems/landmarkChoices';
import { layoutOf, onLayoutChange } from '../ui/layout';
import { COLORS, textStyle } from '../ui/theme';
import type { RunScene } from './RunScene';

const CARD_GAP = 6;
const ACCENT: Record<ChoiceCard['id'], number> = { careful: 0x4fa85a, risky: 0xff7d6b, buy: 0xf2c46b };

/**
 * The choice at a landmark: careful, risky or buy. The run is paused meanwhile; walking away
 * leaves the place unused. Cards answer to a tap, a click or keys 1–3; Esc walks away.
 */
export class LandmarkScene extends Phaser.Scene {
  private done = false;

  constructor() {
    super('Landmark');
  }

  create(): void {
    this.done = false;
    const run = this.scene.get('Run') as RunScene;
    const offer = run.landmarkCards();
    if (!offer) {
      this.time.delayedCall(0, () => this.answer(null));
      return;
    }
    const { cx, cy, width, height, portrait } = layoutOf(this);
    this.add.rectangle(cx, cy, width, height, 0x030805, 0.86);
    this.add.text(cx, portrait ? 30 : 20, offer.name.toUpperCase(), textStyle(16, COLORS.warn)).setOrigin(0.5);
    this.add.text(cx, portrait ? 52 : 38, portrait ? 'ВЫБЕРИТЕ, КАК ДЕЙСТВОВАТЬ' : 'ВЫБЕРИТЕ: 1–3 ИЛИ КАСАНИЕ · ESC — УЙТИ',
      textStyle(8, COLORS.dim)).setOrigin(0.5);
    const count = offer.cards.length;
    if (portrait) {
      const top = 66;
      const cardHeight = Math.min(118, (height - top - 60) / count - CARD_GAP);
      offer.cards.forEach((card, index) => this.card(card, index, 8, top + index * (cardHeight + CARD_GAP), width - 16, cardHeight));
    } else {
      const cardWidth = (width - 16 - CARD_GAP * (count - 1)) / count;
      offer.cards.forEach((card, index) => this.card(card, index, 8 + index * (cardWidth + CARD_GAP), 50, cardWidth, height - 92));
    }
    const leave = this.add.text(cx, height - (portrait ? 24 : 20), 'УЙТИ — РЕШИТЬ ПОЗЖЕ', textStyle(8, COLORS.bright, {
      backgroundColor: '#1d3322', padding: { x: 10, y: 6 },
    })).setOrigin(0.5).setInteractive({ useHandCursor: true });
    leave.on('pointerdown', () => this.answer(null));

    const onKey = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      if (event.code === 'Escape') {
        this.answer(null);
        return;
      }
      const card = offer.cards[Number(event.key) - 1];
      if (card) this.answer(card);
    };
    // A short delay so the key or tap that moved the hero in does not pick a card at once.
    this.time.delayedCall(250, () => this.input.keyboard?.on('keydown', onKey));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.input.keyboard?.off('keydown', onKey));
    onLayoutChange(this, () => this.scene.restart());
  }

  private card(card: ChoiceCard, index: number, left: number, top: number, width: number, height: number): void {
    const accent = ACCENT[card.id];
    const locked = Boolean(card.disabled);
    const box = this.add.rectangle(left + width / 2, top + height / 2, width, height, COLORS.panel, 0.95)
      .setStrokeStyle(locked ? 1 : 2, accent, locked ? 0.4 : 1);
    const wordWrap = { width: width - 16 };
    let y = top + 8;
    const line = (text: string, color: string): void => {
      const label = this.add.text(left + 8, y, text, textStyle(8, color, { wordWrap })).setAlpha(locked ? 0.5 : 1);
      y += label.height + 5;
    };
    this.add.text(left + width - 8, top + 8, `[${index + 1}]`, textStyle(8, COLORS.dim)).setOrigin(1, 0);
    line(card.title.toUpperCase(), locked ? COLORS.dim : Phaser.Display.Color.IntegerToColor(accent).rgba);
    line(card.description, COLORS.text);
    for (const text of card.lines) line(text, COLORS.bright);
    if (card.disabled) line(card.disabled, COLORS.danger);
    if (locked) return;
    box.setInteractive({ useHandCursor: true })
      .on('pointerover', () => box.setFillStyle(0x10241a, 0.98))
      .on('pointerout', () => box.setFillStyle(COLORS.panel, 0.95))
      .on('pointerdown', () => this.answer(card));
  }

  private answer(card: ChoiceCard | null): void {
    if (this.done) return;
    const run = this.scene.get('Run') as RunScene;
    if (card && (card.disabled || !run.answerLandmark(card.id))) {
      playSfx('sfx/ui_error');
      return;
    }
    if (!card) run.answerLandmark(null);
    this.done = true;
    playSfx(card ? 'sfx/ui_buy' : 'sfx/ui_click');
    this.scene.resume('Run');
    this.scene.stop();
  }
}

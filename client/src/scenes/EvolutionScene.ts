import * as Phaser from 'phaser';
import { animationKey, ATLAS } from '../assets';
import { getCatalog } from '../content/catalog';
import { evolutionChanges } from '../content/statText';
import { playSfx } from '../sound';
import { layoutOf, onLayoutChange } from '../ui/layout';
import { COLORS, textStyle } from '../ui/theme';
import type { RunScene } from './RunScene';

const CHARGE_MS = 900;
const LINE_STEP_MS = 140;
const AUTO_CLOSE_MS = 7000;
const AUTOPILOT_CLOSE_MS = 2600;
const SPARKS = 14;
const BLINK_MS = 110;

/**
 * Shown after a weapon evolves: the old icon charges up and bursts into the new one, then the
 * screen lists the new projectile and every number that changed. Run is paused meanwhile.
 */
export class EvolutionScene extends Phaser.Scene {
  private ready = false;
  private closing = false;
  private details: (Phaser.GameObjects.Text | Phaser.GameObjects.Image)[] = [];

  constructor() {
    super('Evolution');
  }

  create({ instant = false }: { instant?: boolean }): void {
    this.ready = false;
    this.closing = false;
    this.details = [];
    const run = this.scene.get('Run') as RunScene;
    const evolution = run.evolution;
    const { weapons, passives } = getCatalog();
    const from = evolution && weapons[evolution.from];
    const into = evolution && weapons[evolution.into];
    if (!evolution || !from || !into) {
      this.time.delayedCall(0, () => this.close());
      return;
    }
    const { cx, width, height, portrait } = layoutOf(this);
    const top = portrait ? 80 : 44;
    const iconY = top + (portrait ? 56 : 34);
    this.add.rectangle(cx, height / 2, width, height, 0x030805, 0.9);
    const title = this.add.text(cx, top - (portrait ? 30 : 22), 'ЭВОЛЮЦИЯ', textStyle(16, COLORS.warn)).setOrigin(0.5);
    this.tweens.add({ targets: title, alpha: 0.5, duration: 500, yoyo: true, repeat: -1 });

    const glow = this.add.sprite(cx, iconY, ATLAS, 'fx/ray').setScale(2.6).setAlpha(0);
    glow.play(animationKey('fx/ray', 'idle'));
    const icon = this.add.image(cx, iconY, ATLAS, from.sprite).setScale(4);
    const name = this.add.text(cx, iconY + 42, from.name.toUpperCase(),
      textStyle(8, COLORS.dim, { align: 'center', wordWrap: { width: width - 24 } })).setOrigin(0.5, 0);

    // Everything below the icon: the recipe, what the weapon does now and what changed.
    const wordWrap = { width: width - 32 };
    let y = iconY + 62;
    const line = (text: string, color: string): Phaser.GameObjects.Text => {
      const item = this.add.text(cx, y, text, textStyle(8, color, { align: 'center', wordWrap })).setOrigin(0.5, 0);
      y += item.height + 6;
      return item;
    };
    const passive = passives[evolution.passive];
    this.details.push(line(`${from.name} + ${passive?.name ?? evolution.passive}`, COLORS.dim));
    this.details.push(line(into.description, COLORS.text));
    const shots = this.add.text(cx - 6, y + 6, 'СНАРЯД', textStyle(8, COLORS.dim)).setOrigin(1, 0.5);
    const oldShot = this.add.image(cx + 14, y + 6, ATLAS, from.projectileSprite).setScale(2);
    const arrow = this.add.text(cx + 34, y + 6, '>', textStyle(8, COLORS.warn)).setOrigin(0.5);
    const newShot = this.add.image(cx + 58, y + 6, ATLAS, into.projectileSprite).setScale(2);
    this.details.push(shots, oldShot, arrow, newShot);
    y += Math.max(18, newShot.displayHeight + 6);
    const changes = evolutionChanges(from.levels.at(-1)!, into.levels[0]!);
    const columns = portrait ? 1 : 2;
    const columnWidth = (width - 40) / columns;
    changes.forEach((change, index) => {
      const column = index === 0 ? 0 : (index - 1) % columns;
      const row = index === 0 ? 0 : 1 + Math.floor((index - 1) / columns);
      const x = index === 0 ? cx : 20 + columnWidth * column + columnWidth / 2;
      this.details.push(this.add.text(x, y + row * 14, change,
        textStyle(8, index === 0 ? COLORS.warn : COLORS.bright)).setOrigin(0.5, 0));
    });
    for (const item of this.details) item.setAlpha(0);
    const hint = this.add.text(cx, height - 18, 'ПРОБЕЛ ИЛИ КАСАНИЕ — ДАЛЬШЕ', textStyle(8, COLORS.dim))
      .setOrigin(0.5).setAlpha(0);

    const transform = (): void => {
      if (this.ready) return;
      this.ready = true;
      this.tweens.killTweensOf(icon);
      playSfx('sfx/level_up');
      this.cameras.main.flash(220, 255, 240, 184);
      this.burst(cx, iconY);
      icon.setFrame(into.sprite).clearTint().setTintMode(Phaser.TintModes.MULTIPLY).setAngle(0).setScale(6);
      this.tweens.add({ targets: icon, scale: 4, duration: 320, ease: 'Back.easeOut' });
      this.tweens.add({ targets: glow, alpha: 0.7, duration: 200 });
      name.setText(into.name.toUpperCase()).setStyle(textStyle(16, COLORS.warn, { align: 'center', wordWrap: { width: width - 24 } }));
      this.tweens.add({ targets: name, scale: { from: 1.4, to: 1 }, duration: 260, ease: 'Back.easeOut' });
      this.details.forEach((item, index) => {
        this.tweens.add({ targets: item, alpha: 1, delay: instant ? 0 : 200 + index * LINE_STEP_MS, duration: 180 });
      });
      this.tweens.add({ targets: hint, alpha: 1, delay: 600, duration: 200 });
      const autoClose = run.autopilotOn ? AUTOPILOT_CLOSE_MS : AUTO_CLOSE_MS;
      this.time.delayedCall(autoClose, () => this.close());
    };

    if (instant) transform();
    else {
      playSfx('sfx/powerup');
      // Charge: the old icon shakes harder and blinks white before it bursts.
      this.tweens.add({ targets: icon, angle: { from: -6, to: 6 }, duration: 60, yoyo: true, repeat: -1 });
      this.tweens.add({ targets: icon, scale: 5, duration: CHARGE_MS, ease: 'Quad.easeIn' });
      this.tweens.add({ targets: glow, alpha: 0.35, duration: CHARGE_MS });
      let lit = false;
      this.time.addEvent({ delay: BLINK_MS, repeat: Math.floor(CHARGE_MS / BLINK_MS) - 1, callback: () => {
        lit = !lit;
        if (lit) icon.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
        else icon.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
      } });
      this.time.delayedCall(CHARGE_MS, transform);
    }

    // A short delay so a tap that chose the card does not skip the screen at once.
    this.time.delayedCall(350, () => {
      this.input.on('pointerdown', () => this.advance(transform));
      this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
        if (!event.repeat && (event.code === 'Space' || event.code === 'Enter')) this.advance(transform);
      });
    });
    onLayoutChange(this, () => this.scene.restart({ instant: true }));
  }

  /** First press skips the charge, the next one closes the screen. */
  private advance(transform: () => void): void {
    if (!this.ready) transform();
    else this.close();
  }

  private burst(x: number, y: number): void {
    for (let index = 0; index < SPARKS; index += 1) {
      const angle = (index / SPARKS) * Math.PI * 2;
      const spark = this.add.image(x, y, ATLAS, 'fx/hit').setScale(1.5).setTint(0xf2c46b);
      const reach = 46 + (index % 3) * 14;
      this.tweens.add({ targets: spark, x: x + Math.cos(angle) * reach, y: y + Math.sin(angle) * reach,
        alpha: 0, scale: 0.4, duration: 520, ease: 'Cubic.easeOut', onComplete: () => spark.destroy() });
    }
    const ring = this.add.circle(x, y, 10).setStrokeStyle(2, 0xfff0b8);
    this.tweens.add({ targets: ring, radius: 70, alpha: 0, duration: 420, ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy() });
  }

  /** The next evolution from the same chest plays at once; the run goes on after the last one. */
  private close(): void {
    if (this.closing) return;
    this.closing = true;
    playSfx('sfx/ui_click');
    if ((this.scene.get('Run') as RunScene).nextEvolution()) {
      this.scene.restart({ instant: false });
      return;
    }
    this.scene.resume('Run');
    this.scene.stop();
  }
}

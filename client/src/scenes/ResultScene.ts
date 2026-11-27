import * as Phaser from 'phaser';
import { finishRun, type RunSummary } from '../api/game';
import { ATLAS } from '../assets';
import { getCatalog } from '../content/catalog';
import { runReward } from '../economy';
import { playSfx, stopMusic } from '../sound';
import { layoutOf, onLayoutChange } from '../ui/layout';
import { COLORS, textStyle } from '../ui/theme';

export interface ResultData {
  reason: 'death' | 'survived' | 'quit';
  seconds: number;
  kills: number;
  level: number;
  seed: number;
  runId: string;
  bossKilled: boolean;
  locationId: string;
  summary: RunSummary;
}

export class ResultScene extends Phaser.Scene {
  private result!: ResultData;
  private rewardLabel!: Phaser.GameObjects.Text;
  private actionLabel!: Phaser.GameObjects.Text;
  private leaveLabel!: Phaser.GameObjects.Text;
  private settled = false;
  private sending = false;

  constructor() {
    super('Result');
  }

  init(data: ResultData): void {
    this.result = data;
    this.settled = false;
    this.sending = false;
  }

  create(): void {
    stopMusic();
    this.cameras.main.setBackgroundColor('#08120b');
    const { cx, cy, width, portrait } = layoutOf(this);
    this.add.rectangle(cx, cy, width - 24, portrait ? 400 : 246, COLORS.panel, 1).setStrokeStyle(1, COLORS.panelBorder);
    const title = this.result.bossKilled ? 'ПОБЕДА!' : { death: 'ЗАБЕГ ОКОНЧЕН', survived: 'ВЫЖИЛ!', quit: 'ВОЗВРАЩЕНИЕ' }[this.result.reason];
    this.add.text(cx, cy - (portrait ? 165 : 95), title,
      textStyle(portrait ? 16 : 24, this.result.reason === 'death' ? COLORS.danger : COLORS.bright)).setOrigin(0.5);
    const minutes = Math.floor(this.result.seconds / 60).toString().padStart(2, '0');
    const seconds = (this.result.seconds % 60).toString().padStart(2, '0');
    this.add.text(cx, cy - (portrait ? 120 : 49),
      `ВРЕМЯ ${minutes}:${seconds}   УБИТО ${this.result.kills}   УР.${this.result.level}   КРЫШЕК ${this.result.summary.picked_caps}`,
      textStyle(8, COLORS.text, { align: 'center', wordWrap: { width: width - 48 } })).setOrigin(0.5);
    this.add.text(cx, cy - (portrait ? 90 : 31), `SEED ${this.result.seed}`, textStyle(8, COLORS.dim)).setOrigin(0.5);
    this.add.image(cx, cy - (portrait ? 62 : 12), ATLAS, 'ui/cap').setScale(2);
    this.rewardLabel = this.add.text(cx, cy + (portrait ? 34 : 38), '', textStyle(8, COLORS.bright, {
      align: 'center', wordWrap: { width: width - 60 },
    })).setOrigin(0.5);
    this.actionLabel = this.add.text(cx, cy + (portrait ? 142 : 86), '', textStyle(8, COLORS.bright, {
      backgroundColor: '#1d3322', padding: { x: 12, y: 7 },
    })).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.actionLabel.on('pointerdown', () => this.onAction());
    this.input.keyboard?.on('keydown-SPACE', () => this.onAction());
    this.leaveLabel = this.add.text(cx, cy + (portrait ? 178 : 109), 'ВЕРНУТЬСЯ БЕЗ НАГРАДЫ', textStyle(8, COLORS.dim))
      .setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { if (!this.sending) this.scene.start('Hub'); });
    onLayoutChange(this, () => this.scene.restart(this.result));
    void this.settle();
  }

  private onAction(): void {
    playSfx('sfx/ui_click');
    if (this.settled) this.scene.start('Hub');
    else void this.settle();
  }

  private async settle(): Promise<void> {
    if (this.sending || this.settled) return;
    this.sending = true;
    const summary = this.result.summary;
    const catalog = getCatalog();
    const { cx } = layoutOf(this);
    const estimate = runReward(catalog.balance.reward, {
      duration: summary.duration_seconds,
      kills: Object.values(summary.kills_by_type).reduce((sum, value) => sum + value, 0),
      wave: summary.wave_reached, bossKilled: summary.boss_killed, pickedCaps: summary.picked_caps,
      multiplier: catalog.locations[this.result.locationId]?.rewardMultiplier ?? 1,
    });
    this.rewardLabel.setText(`Сервер считает награду… (≈ ${estimate} крышек)`);
    this.actionLabel.setText('ПОДОЖДИТЕ…');
    try {
      const response = await finishRun(this.result.runId, summary);
      if (!this.scene.isActive()) return;
      this.settled = true;
      this.leaveLabel.setVisible(false);
      const earned = response.achievements.map((id) => {
        const item = catalog.achievements[id];
        return item ? item.name : id;
      });
      const note = response.flags.length
        ? '\nСервер скорректировал сводку забега, награда урезана.' : '';
      this.rewardLabel.setText(
        `Награда: +${response.reward_caps} крышек${
          response.reward_emeralds ? `, +${response.reward_emeralds} изумрудов` : ''
        }\nВсего: ${response.profile.caps} крышек, ${response.profile.emeralds} изумрудов${note}${earned.length ? `\nДостижения: ${earned.join(', ')}. Награда ждёт в убежище` : ''}`,
      );
      this.actionLabel.setText('В УБЕЖИЩЕ');
      playSfx('sfx/reward');
      if (response.reward_emeralds) this.burst(cx, this.rewardLabel.y - 18, Math.min(10, response.reward_emeralds));
      this.showAchievements(response.achievements);
    } catch (error) {
      if (!this.scene.isActive()) return;
      const message = error instanceof Error ? error.message : 'Не удалось связаться с сервером.';
      this.rewardLabel.setText(`Награда не получена: ${message}`);
      this.actionLabel.setText('ПОВТОРИТЬ');
      playSfx('sfx/ui_error');
    } finally {
      this.sending = false;
    }
  }

  /** Each new achievement slides up at the bottom edge in turn (the leave link is gone by then), with a flash and a spray of emeralds. */
  private showAchievements(ids: readonly string[]): void {
    const { achievements } = getCatalog();
    const { cx, width, height } = layoutOf(this);
    const cardWidth = Math.min(width - 24, 300);
    ids.forEach((id, index) => {
      const item = achievements[id];
      const delay = 500 + index * 1900;
      const y = height - 20;
      const away = height + 40;
      const card = this.add.container(cx, away).setDepth(10);
      const ray = this.add.image(0, 0, ATLAS, 'fx/ray').setScale(1.6).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
      const box = this.add.rectangle(0, 0, cardWidth, 34, 0x1d2a12, 0.96).setStrokeStyle(2, 0xffd84a);
      const icon = this.add.image(-cardWidth / 2 + 20, 0, ATLAS, 'ui/emerald').setScale(2);
      const head = this.add.text(-cardWidth / 2 + 38, -12, 'ДОСТИЖЕНИЕ!', textStyle(8, COLORS.warn));
      const name = this.add.text(-cardWidth / 2 + 38, 0, item?.name ?? id, textStyle(8, COLORS.bright, {
        wordWrap: { width: cardWidth - 92 } }));
      const prize = this.add.text(cardWidth / 2 - 8, 0, item ? `+${item.emeralds}` : '', textStyle(8, COLORS.bright))
        .setOrigin(1, 0.5);
      const shine = this.add.rectangle(-cardWidth / 2, 0, 10, 32, 0xffffff, 0.35).setAngle(18)
        .setBlendMode(Phaser.BlendModes.ADD);
      card.add([ray, box, icon, head, name, prize, shine]);
      this.tweens.chain({ targets: card, tweens: [
        { y, delay, duration: 380, ease: 'Back.easeOut', onStart: () => playSfx('sfx/emerald') },
        { scale: 1.06, duration: 120, yoyo: true, onComplete: () => this.burst(cx - cardWidth / 2 + 20, y, 8) },
        { y, duration: 1100 },
        { y: away, alpha: 0, duration: 260, ease: 'Quad.easeIn', onComplete: () => card.destroy() },
      ] });
      this.tweens.add({ targets: ray, alpha: { from: 0, to: 0.7 }, angle: 90, delay: delay + 300,
        duration: 700, yoyo: true });
      this.tweens.add({ targets: shine, x: cardWidth / 2, delay: delay + 380, duration: 520, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: icon, angle: { from: -12, to: 12 }, delay, duration: 160, yoyo: true, repeat: 3 });
    });
  }

  /** A spray of emeralds that fall and fade. */
  private burst(x: number, y: number, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = -Math.PI / 2 + (index / Math.max(1, count - 1) - 0.5) * 2.4;
      const speed = 34 + (index % 3) * 14;
      const gem = this.add.image(x, y, ATLAS, 'ui/emerald').setDepth(11).setScale(1.4);
      this.tweens.add({
        targets: gem, x: x + Math.cos(angle) * speed, y: y + Math.sin(angle) * speed + 26,
        angle: (index % 2 ? 1 : -1) * 180, alpha: 0, scale: 0.6, duration: 700 + index * 25, ease: 'Quad.easeOut',
        onComplete: () => gem.destroy(),
      });
    }
  }
}

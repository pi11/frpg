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
}

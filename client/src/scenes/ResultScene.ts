import * as Phaser from 'phaser';
import { finishRun, type RunSummary } from '../api/game';
import { ATLAS } from '../assets';
import { getCatalog } from '../content/catalog';
import { runReward } from '../economy';
import { playSfx, stopMusic } from '../sound';
import { COLORS, textStyle } from '../ui/theme';

export interface ResultData {
  reason: 'death' | 'survived';
  seconds: number;
  kills: number;
  level: number;
  seed: number;
  runId: string;
  bossKilled: boolean;
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
    this.add.rectangle(240, 135, 456, 246, COLORS.panel, 1).setStrokeStyle(1, COLORS.panelBorder);
    const title = this.result.bossKilled ? 'ПОБЕДА!' : this.result.reason === 'death' ? 'ЗАБЕГ ОКОНЧЕН' : 'ВЫЖИЛ!';
    this.add.text(240, 40, title,
      textStyle(24, this.result.reason === 'death' ? COLORS.danger : COLORS.bright)).setOrigin(0.5);
    const minutes = Math.floor(this.result.seconds / 60).toString().padStart(2, '0');
    const seconds = (this.result.seconds % 60).toString().padStart(2, '0');
    this.add.text(240, 86,
      `ВРЕМЯ ${minutes}:${seconds}   УБИТО ${this.result.kills}   УР.${this.result.level}   КРЫШЕК ${this.result.summary.picked_caps}`,
      textStyle(8, COLORS.text, { align: 'center' })).setOrigin(0.5);
    this.add.text(240, 102, `SEED ${this.result.seed}`, textStyle(8, COLORS.dim)).setOrigin(0.5);
    this.add.image(240, 128, ATLAS, 'ui/cap').setScale(2);
    this.rewardLabel = this.add.text(240, 166, '', textStyle(8, COLORS.bright, {
      align: 'center', wordWrap: { width: 420 },
    })).setOrigin(0.5);
    this.actionLabel = this.add.text(240, 214, '', textStyle(8, COLORS.bright, {
      backgroundColor: '#1d3322', padding: { x: 12, y: 7 },
    })).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.actionLabel.on('pointerdown', () => this.onAction());
    this.input.keyboard?.on('keydown-SPACE', () => this.onAction());
    this.leaveLabel = this.add.text(240, 244, 'ВЕРНУТЬСЯ БЕЗ НАГРАДЫ', textStyle(8, COLORS.dim))
      .setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { if (!this.sending) this.scene.start('Hub'); });
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
    const estimate = runReward(getCatalog().balance.reward, {
      duration: summary.duration_seconds,
      kills: Object.values(summary.kills_by_type).reduce((sum, value) => sum + value, 0),
      wave: summary.wave_reached, bossKilled: summary.boss_killed, pickedCaps: summary.picked_caps,
    });
    this.rewardLabel.setText(`Сервер считает награду… (≈ ${estimate} крышек)`);
    this.actionLabel.setText('ПОДОЖДИТЕ…');
    try {
      const response = await finishRun(this.result.runId, summary);
      if (!this.scene.isActive()) return;
      this.settled = true;
      this.leaveLabel.setVisible(false);
      const note = response.flags.length
        ? '\nСервер скорректировал сводку забега, награда урезана.' : '';
      this.rewardLabel.setText(
        `Награда: +${response.reward_caps} крышек\nВсего: ${response.profile.caps}${note}`,
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

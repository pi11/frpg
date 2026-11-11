import * as Phaser from 'phaser';
import { finishRun, type RunSummary } from '../api/game';
import { getCatalog } from '../content/catalog';
import { runReward } from '../economy';

export interface ResultData {
  reason: 'death' | 'survived';
  seconds: number;
  kills: number;
  level: number;
  seed: number;
  runId: string;
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
    this.cameras.main.setBackgroundColor('#17211c');
    this.add.text(240, 52, this.result.reason === 'death' ? 'ЗАБЕГ ОКОНЧЕН' : 'ВЫЖИЛ!', {
      fontFamily: 'monospace', fontSize: '24px', color: '#9acb9b',
    }).setOrigin(0.5);
    const minutes = Math.floor(this.result.seconds / 60).toString().padStart(2, '0');
    const seconds = (this.result.seconds % 60).toString().padStart(2, '0');
    this.add.text(240, 100,
      `Время ${minutes}:${seconds}   Убийств ${this.result.kills}   Уровень ${this.result.level}\nSeed ${this.result.seed}`, {
        fontFamily: 'monospace', fontSize: '12px', color: '#e4dcba', align: 'center',
      }).setOrigin(0.5);
    this.rewardLabel = this.add.text(240, 150, '', {
      fontFamily: 'monospace', fontSize: '12px', color: '#e4dcba', align: 'center',
      wordWrap: { width: 440 },
    }).setOrigin(0.5);
    this.actionLabel = this.add.text(240, 215, '', {
      fontFamily: 'monospace', fontSize: '12px', color: '#9acb9b',
      backgroundColor: '#344835', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.actionLabel.on('pointerdown', () => this.onAction());
    this.input.keyboard?.on('keydown-SPACE', () => this.onAction());
    this.leaveLabel = this.add.text(240, 250, 'Вернуться без награды', {
      fontFamily: 'monospace', fontSize: '9px', color: '#7d9782',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { if (!this.sending) this.scene.start('Hub'); });
    void this.settle();
  }

  private onAction(): void {
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
    this.actionLabel.setText('Подождите…');
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
      this.actionLabel.setText('В убежище');
    } catch (error) {
      if (!this.scene.isActive()) return;
      const message = error instanceof Error ? error.message : 'Не удалось связаться с сервером.';
      this.rewardLabel.setText(`Награда не получена: ${message}`);
      this.actionLabel.setText('Повторить');
    } finally {
      this.sending = false;
    }
  }
}

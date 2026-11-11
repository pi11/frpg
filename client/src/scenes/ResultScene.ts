import * as Phaser from 'phaser';

interface ResultData {
  reason: 'death' | 'survived';
  seconds: number;
  kills: number;
  level: number;
  seed: number;
}

export class ResultScene extends Phaser.Scene {
  private result!: ResultData;

  constructor() {
    super('Result');
  }

  init(data: ResultData): void {
    this.result = data;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#17211c');
    this.add.text(240, 64, this.result.reason === 'death' ? 'ЗАБЕГ ОКОНЧЕН' : 'ВЫЖИЛ!', {
      fontFamily: 'monospace', fontSize: '24px', color: '#9acb9b',
    }).setOrigin(0.5);
    const minutes = Math.floor(this.result.seconds / 60).toString().padStart(2, '0');
    const seconds = (this.result.seconds % 60).toString().padStart(2, '0');
    this.add.text(240, 125,
      `Время ${minutes}:${seconds}   Убийств ${this.result.kills}   Уровень ${this.result.level}\nSeed ${this.result.seed}`, {
        fontFamily: 'monospace', fontSize: '12px', color: '#e4dcba', align: 'center',
      }).setOrigin(0.5);
    this.add.text(240, 210, 'Нажми, чтобы начать снова', {
      fontFamily: 'monospace', fontSize: '12px', color: '#9acb9b',
    }).setOrigin(0.5);
    const restart = (): void => {
      this.scene.start('Boot');
    };
    this.input.once('pointerdown', restart);
    this.input.keyboard?.once('keydown-SPACE', restart);
  }
}

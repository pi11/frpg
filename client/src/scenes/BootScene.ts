import * as Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.add.text(240, 120, 'ПУСТОШЬ', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#99c78e',
    }).setOrigin(0.5);
    this.add.text(240, 152, 'Этап 0 · каркас игры', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#7d9782',
    }).setOrigin(0.5);
  }
}

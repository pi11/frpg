import * as Phaser from 'phaser';
import { VirtualJoystick } from '../ui/VirtualJoystick';
import { RunScene } from './RunScene';

export class HudScene extends Phaser.Scene {
  private run!: RunScene;
  private hpBar!: Phaser.GameObjects.Graphics;
  private xpBar!: Phaser.GameObjects.Graphics;
  private stats!: Phaser.GameObjects.Text;
  private fps!: Phaser.GameObjects.Text;
  private pauseLabel!: Phaser.GameObjects.Text;
  private refreshAt = 0;

  constructor() {
    super('Hud');
  }

  create(): void {
    this.run = this.scene.get('Run') as RunScene;
    this.add.rectangle(240, 11, 480, 22, 0x0c1510, 0.85);
    this.hpBar = this.add.graphics();
    this.xpBar = this.add.graphics();
    this.stats = this.add.text(8, 27, '', {
      fontFamily: 'monospace', fontSize: '11px', color: '#e4dcba',
    });
    this.fps = this.add.text(8, 252, '', {
      fontFamily: 'monospace', fontSize: '9px', color: '#b8c7a7',
    });
    this.pauseLabel = this.add.text(240, 135, 'ПАУЗА\nP — продолжить', {
      fontFamily: 'monospace', fontSize: '20px', color: '#e4dcba', align: 'center',
    }).setOrigin(0.5).setDepth(90).setVisible(false);

    this.add.text(440, 4, 'Ⅱ P', {
      fontFamily: 'monospace', fontSize: '12px', color: '#e4dcba',
      backgroundColor: '#26372a', padding: { x: 3, y: 1 },
    }).setInteractive().on('pointerdown', () => this.togglePause());
    const onPause = (): void => this.togglePause();
    this.input.keyboard?.on('keydown-P', onPause);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-P', onPause);
    });
    new VirtualJoystick(this);
  }

  update(time: number): void {
    if (time < this.refreshAt) return;
    this.refreshAt = time + 100;
    const view = this.run.view;
    this.hpBar.clear().fillStyle(0x294432).fillRect(8, 5, 145, 5)
      .fillStyle(0xb9665a).fillRect(8, 5, 145 * (view.hp / view.maxHp), 5);
    this.xpBar.clear().fillStyle(0x294432).fillRect(8, 14, 145, 4)
      .fillStyle(0x8ebba4).fillRect(8, 14, 145 * (view.xp / view.nextXp), 4);
    const minutes = Math.floor(view.seconds / 60).toString().padStart(2, '0');
    const seconds = (view.seconds % 60).toString().padStart(2, '0');
    this.stats.setText(`HP ${view.hp}/${view.maxHp}   Ур. ${view.level}   ${minutes}:${seconds}   Убийств ${view.kills}`);
    if (import.meta.env.DEV) {
      this.fps.setText(`FPS ${Math.round(this.game.loop.actualFps)}  врагов ${view.enemyCount}  пуль ${view.projectileCount}  seed ${view.seed}`);
    }
  }

  private togglePause(): void {
    if (this.scene.isActive('LevelUp')) return;
    if (this.scene.isPaused('Run')) {
      this.scene.resume('Run');
      this.pauseLabel.setVisible(false);
    } else {
      this.scene.pause('Run');
      this.pauseLabel.setVisible(true);
    }
  }
}

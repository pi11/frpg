import * as Phaser from 'phaser';
import { ATLAS } from '../assets';
import { playSfx } from '../sound';
import { VirtualJoystick } from '../ui/VirtualJoystick';
import { COLORS, textStyle } from '../ui/theme';
import { RunScene } from './RunScene';

export class HudScene extends Phaser.Scene {
  private run!: RunScene;
  private hpBar!: Phaser.GameObjects.Graphics;
  private xpBar!: Phaser.GameObjects.Graphics;
  private stats!: Phaser.GameObjects.Text;
  private level!: Phaser.GameObjects.Text;
  private timer!: Phaser.GameObjects.Text;
  private fps!: Phaser.GameObjects.Text;
  private caps!: Phaser.GameObjects.Text;
  private bossName!: Phaser.GameObjects.Text;
  private bossBar!: Phaser.GameObjects.Graphics;
  private warning!: Phaser.GameObjects.Text;
  private pausePanel!: Phaser.GameObjects.Container;
  private refreshAt = 0;

  constructor() {
    super('Hud');
  }

  create(): void {
    this.run = this.scene.get('Run') as RunScene;
    this.add.rectangle(240, 13, 480, 26, COLORS.panel, 0.82);
    this.add.rectangle(240, 26, 480, 1, COLORS.panelBorder, 0.7);
    this.add.text(6, 4, 'HP', textStyle(8, COLORS.dim));
    this.add.text(6, 15, 'XP', textStyle(8, COLORS.dim));
    this.hpBar = this.add.graphics();
    this.xpBar = this.add.graphics();
    this.level = this.add.text(166, 4, '', textStyle(8, COLORS.bright));
    this.timer = this.add.text(240, 31, '', textStyle(16, COLORS.bright)).setOrigin(0.5, 0);
    this.stats = this.add.text(166, 15, '', textStyle(8, COLORS.text));
    this.fps = this.add.text(6, 260, '', textStyle(8, COLORS.dim));
    this.add.image(392, 9, ATLAS, 'ui/cap');
    this.caps = this.add.text(402, 5, '0', textStyle(8, COLORS.warn));
    this.bossName = this.add.text(240, 238, '', textStyle(8, COLORS.danger)).setOrigin(0.5);
    this.bossBar = this.add.graphics();
    this.warning = this.add.text(240, 90, '', textStyle(16, COLORS.danger, {
      backgroundColor: '#1a0806', padding: { x: 8, y: 6 },
    })).setOrigin(0.5).setDepth(80).setVisible(false);

    const panel = this.add.rectangle(0, 0, 200, 64, COLORS.panel, 0.92)
      .setStrokeStyle(1, COLORS.panelBorder);
    const title = this.add.text(0, -12, 'ПАУЗА', textStyle(16, COLORS.bright)).setOrigin(0.5);
    const hint = this.add.text(0, 14, 'P — продолжить', textStyle(8, COLORS.dim)).setOrigin(0.5);
    this.pausePanel = this.add.container(240, 135, [panel, title, hint]).setDepth(90).setVisible(false);

    const pauseButton = this.add.text(452, 6, 'II', textStyle(8, COLORS.bright, {
      backgroundColor: '#1d3322', padding: { x: 5, y: 4 },
    })).setInteractive({ useHandCursor: true });
    pauseButton.on('pointerdown', () => this.togglePause());
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
    const hp = Math.max(0, Math.min(1, view.hp / view.maxHp));
    const xp = Math.max(0, Math.min(1, view.xp / view.nextXp));
    this.hpBar.clear().fillStyle(COLORS.barBack).fillRect(26, 5, 132, 6)
      .fillStyle(COLORS.hp).fillRect(26, 5, Math.round(132 * hp), 6);
    this.xpBar.clear().fillStyle(COLORS.barBack).fillRect(26, 16, 132, 6)
      .fillStyle(COLORS.xp).fillRect(26, 16, Math.round(132 * xp), 6);
    const minutes = Math.floor(view.seconds / 60).toString().padStart(2, '0');
    const seconds = (view.seconds % 60).toString().padStart(2, '0');
    this.timer.setText(`${minutes}:${seconds}`);
    this.level.setText(`${Math.ceil(view.hp)}/${Math.round(view.maxHp)}  УР.${view.level}`);
    this.stats.setText(`ВОЛНА ${view.wave}  УБИТО ${view.kills}`);
    this.caps.setText(String(view.caps));
    this.bossBar.clear();
    if (view.boss) {
      this.bossName.setText(view.boss.name.toUpperCase()).setVisible(true);
      this.bossBar.fillStyle(COLORS.barBack).fillRect(120, 248, 240, 6)
        .fillStyle(COLORS.hp).fillRect(120, 248, Math.round(240 * view.boss.fraction), 6)
        .lineStyle(1, COLORS.panelBorder).strokeRect(119.5, 247.5, 241, 7);
    } else {
      this.bossName.setVisible(false);
    }
    this.warning.setText(view.warning).setVisible(Boolean(view.warning)
      && (view.warning === 'ПОБЕДА!' || Math.floor(time / 250) % 2 === 0));
    if (import.meta.env.DEV) {
      this.fps.setText(`FPS ${Math.round(this.game.loop.actualFps)} ВРАГОВ ${view.enemyCount} ПУЛЬ ${view.projectileCount} SEED ${view.seed}`);
    }
  }

  private togglePause(): void {
    if (this.scene.isActive('LevelUp') || this.scene.isActive('Chest')) return;
    playSfx('sfx/ui_click');
    if (this.scene.isPaused('Run')) {
      this.scene.resume('Run');
      this.pausePanel.setVisible(false);
    } else {
      this.scene.pause('Run');
      this.pausePanel.setVisible(true);
    }
  }
}

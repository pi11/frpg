import * as Phaser from 'phaser';
import { settings, updateSettings } from '../settings';
import { playSfx } from '../sound';
import { COLORS, textStyle } from './theme';

const SLIDER_WIDTH = 110;
const VOLUMES = [['music', 'МУЗЫКА'], ['sfx', 'ЗВУКИ']] as const;

interface Actions {
  resume: () => void;
  leave: () => void;
}

/** Pause menu: continue, volumes and a two-step return to the shelter. */
export class PausePanel {
  private readonly root: Phaser.GameObjects.Container;
  private readonly leave: Phaser.GameObjects.Text;
  private readonly refresh: (() => void)[] = [];
  private confirming = false;

  constructor(private readonly scene: Phaser.Scene, actions: Actions) {
    const panel = scene.add.rectangle(0, 0, 270, 150, COLORS.panel, 0.95)
      .setStrokeStyle(1, COLORS.panelBorder).setInteractive();
    const title = scene.add.text(0, -60, 'ПАУЗА', textStyle(16, COLORS.bright)).setOrigin(0.5);
    const resume = this.button(-36, 'ПРОДОЛЖИТЬ [ESC]', actions.resume);
    this.leave = this.button(48, '', () => {
      if (this.confirming) {
        actions.leave();
        return;
      }
      playSfx('sfx/ui_click');
      this.confirming = true;
      this.updateLeave();
    });
    this.root = scene.add.container(240, 135, [panel, title, resume, this.leave]).setDepth(90);
    VOLUMES.forEach(([key, label], index) => this.slider(-10 + index * 20, key, label));
    this.hide();
  }

  show(): void {
    this.confirming = false;
    this.updateLeave();
    for (const update of this.refresh) update();
    this.root.setVisible(true);
  }

  hide(): void {
    this.root.setVisible(false);
  }

  private updateLeave(): void {
    this.leave.setText(this.confirming ? 'ТОЧНО? НАЖМИТЕ ЕЩЁ РАЗ' : 'ВЕРНУТЬСЯ В УБЕЖИЩЕ')
      .setColor(this.confirming ? COLORS.danger : COLORS.text);
  }

  private button(y: number, text: string, action: () => void): Phaser.GameObjects.Text {
    return this.scene.add.text(0, y, text, textStyle(8, COLORS.bright, {
      backgroundColor: '#1d3322', padding: { x: 10, y: 6 },
    })).setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerdown', action);
  }

  private slider(y: number, key: 'music' | 'sfx', label: string): void {
    const left = -44;
    const caption = this.scene.add.text(-122, y, label, textStyle(8, COLORS.dim)).setOrigin(0, 0.5);
    const value = this.scene.add.text(122, y, '', textStyle(8, COLORS.warn)).setOrigin(1, 0.5);
    const track = this.scene.add.rectangle(left, y, SLIDER_WIDTH, 6, COLORS.barBack).setOrigin(0, 0.5);
    const fill = this.scene.add.rectangle(left, y, 1, 6, COLORS.xp).setOrigin(0, 0.5);
    const knob = this.scene.add.rectangle(left, y, 5, 12, COLORS.panelBorder);
    const hit = this.scene.add.rectangle(left - 6, y, SLIDER_WIDTH + 12, 18, 0, 0).setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true });
    const update = (): void => {
      const level = settings()[key];
      value.setText(`${Math.round(level * 100)}%`);
      fill.setSize(Math.max(1, SLIDER_WIDTH * level), 6).setVisible(level > 0);
      knob.setX(left + SLIDER_WIDTH * level);
    };
    const drag = (pointer: Phaser.Input.Pointer): void => {
      const share = (pointer.x - this.root.x - left) / SLIDER_WIDTH;
      updateSettings({ [key]: Math.round(Math.min(1, Math.max(0, share)) * 20) / 20 });
      update();
    };
    hit.on('pointerdown', drag);
    hit.on('pointermove', (pointer: Phaser.Input.Pointer) => { if (pointer.isDown) drag(pointer); });
    if (key === 'sfx') hit.on('pointerup', () => playSfx('sfx/ui_buy'));
    this.refresh.push(update);
    this.root.add([caption, track, fill, knob, value, hit]);
  }
}

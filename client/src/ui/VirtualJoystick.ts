import * as Phaser from 'phaser';
import { inputState } from '../inputState';

/** Touch: a floating stick under the finger, anywhere. Mouse: the hero walks towards the cursor. */
export class VirtualJoystick {
  private readonly scene: Phaser.Scene;
  private readonly base: Phaser.GameObjects.Graphics;
  private readonly thumb: Phaser.GameObjects.Graphics;
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private readonly radius = 42;
  private readonly enabled: () => boolean;

  /** `enabled` is asked on every press: no stick while the run is paused. */
  constructor(scene: Phaser.Scene, enabled: () => boolean) {
    this.scene = scene;
    this.enabled = enabled;
    this.base = scene.add.graphics().setDepth(100).setVisible(false);
    this.thumb = scene.add.graphics().setDepth(101).setVisible(false);
    scene.input.on('pointerdown', this.onDown, this);
    scene.input.on('pointermove', this.onMove, this);
    scene.input.on('pointerup', this.onUp, this);
    scene.input.on('pointerupoutside', this.onUp, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private onDown(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    // Presses on HUD buttons belong to the buttons.
    if (this.pointerId !== null || over.length || !this.enabled()) return;
    if (!pointer.wasTouch) {
      inputState.mouse.press(pointer.x, pointer.y, pointer.event.timeStamp);
      return;
    }
    this.pointerId = pointer.id;
    this.originX = pointer.x;
    this.originY = pointer.y;
    this.base.clear().lineStyle(2, 0x4fa85a, 0.8)
      .fillStyle(0x17211c, 0.5).fillCircle(pointer.x, pointer.y, this.radius)
      .strokeCircle(pointer.x, pointer.y, this.radius).setVisible(true);
    this.thumb.setVisible(true);
    this.onMove(pointer);
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    if (!pointer.wasTouch) inputState.mouse.move(pointer.x, pointer.y);
    if (pointer.id !== this.pointerId) return;
    const dx = pointer.x - this.originX;
    const dy = pointer.y - this.originY;
    const length = Math.hypot(dx, dy);
    const scale = length > this.radius ? this.radius / length : 1;
    const x = dx * scale;
    const y = dy * scale;
    inputState.x = x / this.radius;
    inputState.y = y / this.radius;
    this.thumb.clear().fillStyle(0x4fa85a, 0.8)
      .fillCircle(this.originX + x, this.originY + y, 15);
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    if (!pointer.wasTouch) inputState.mouse.release(pointer.event.timeStamp);
    if (pointer.id !== this.pointerId) return;
    this.pointerId = null;
    inputState.x = 0;
    inputState.y = 0;
    this.base.setVisible(false);
    this.thumb.setVisible(false);
  }

  private destroy(): void {
    this.scene.input.off('pointerdown', this.onDown, this);
    this.scene.input.off('pointermove', this.onMove, this);
    this.scene.input.off('pointerup', this.onUp, this);
    this.scene.input.off('pointerupoutside', this.onUp, this);
    inputState.x = 0;
    inputState.y = 0;
    inputState.mouse.cancel();
    this.base.destroy();
    this.thumb.destroy();
  }
}

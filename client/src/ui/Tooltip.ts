import * as Phaser from 'phaser';
import { COLORS, textStyle } from './theme';

const WIDTH = 190;
const PADDING = 6;

/** Mouse-only popup with a title and a few lines, kept inside the screen. */
export class Tooltip {
  private readonly panel: Phaser.GameObjects.Rectangle;
  private readonly title: Phaser.GameObjects.Text;
  private readonly body: Phaser.GameObjects.Text;
  private shown = '';

  constructor(scene: Phaser.Scene) {
    this.panel = scene.add.rectangle(0, 0, WIDTH, 10, COLORS.panel, 0.96).setOrigin(0)
      .setStrokeStyle(1, COLORS.panelBorder).setDepth(120).setVisible(false);
    const wrap = { wordWrap: { width: WIDTH - PADDING * 2 } };
    this.title = scene.add.text(0, 0, '', textStyle(8, COLORS.warn, wrap)).setDepth(121).setVisible(false);
    this.body = scene.add.text(0, 0, '', textStyle(8, COLORS.text, wrap)).setDepth(121).setVisible(false);
  }

  /** `anchor` is the middle of the hovered icon; the popup opens above it, or below at the top edge. */
  show(anchor: { x: number; y: number }, title: string, lines: readonly string[]): void {
    const key = `${anchor.x},${anchor.y},${title},${lines.join('|')}`;
    if (key === this.shown) return;
    this.shown = key;
    this.title.setText(title.toUpperCase());
    this.body.setText(lines.join('\n'));
    const height = this.title.height + this.body.height + PADDING * 2 + 4;
    const x = Phaser.Math.Clamp(Math.round(anchor.x - WIDTH / 2), 4, 476 - WIDTH);
    const above = anchor.y - 14 - height;
    const y = Math.round(above >= 4 ? above : anchor.y + 14);
    this.panel.setPosition(x, y).setSize(WIDTH, height);
    this.title.setPosition(x + PADDING, y + PADDING);
    this.body.setPosition(x + PADDING, y + PADDING + this.title.height + 4);
    this.setVisible(true);
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = '';
    this.setVisible(false);
  }

  private setVisible(visible: boolean): void {
    for (const part of [this.panel, this.title, this.body]) part.setVisible(visible);
  }
}

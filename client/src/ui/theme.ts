import type * as Phaser from 'phaser';

/** Terminal-style UI: green monochrome on near-black, one pixel font. */
export const FONT = '"Press Start 2P"';

export const COLORS = {
  text: '#b8f5a8',
  dim: '#5f9a63',
  bright: '#e4ffd8',
  warn: '#f2c46b',
  danger: '#ff7d6b',
  panel: 0x08120b,
  panelBorder: 0x4fa85a,
  barBack: 0x1d3322,
  hp: 0xd8644f,
  xp: 0x9bff6e,
} as const;

export function textStyle(
  size: 8 | 16 | 24 = 8, color: string = COLORS.text,
  extra: Phaser.Types.GameObjects.Text.TextStyle = {},
): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${size}px`, color, lineSpacing: Math.round(size / 2), ...extra };
}

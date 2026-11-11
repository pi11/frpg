import * as Phaser from 'phaser';
import { getCatalog } from '../content/catalog';

function square(scene: Phaser.Scene, key: string, size: number, color: number): void {
  if (scene.textures.exists(key)) return;
  const graphics = scene.make.graphics({ x: 0, y: 0 });
  graphics.fillStyle(color);
  graphics.fillRect(0, 0, size, size);
  graphics.generateTexture(key, size, size);
  graphics.destroy();
}

function colorFor(key: string, colors: readonly number[]): number {
  let hash = 0;
  for (const char of key) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length]!;
}

function ground(scene: Phaser.Scene, key: string): void {
  if (scene.textures.exists(key)) return;
  const graphics = scene.make.graphics({ x: 0, y: 0 });
  graphics.fillStyle(0x4a4034);
  graphics.fillRect(0, 0, 32, 32);
  graphics.fillStyle(0x574b3a);
  graphics.fillRect(0, 0, 16, 16);
  graphics.fillRect(16, 16, 16, 16);
  graphics.generateTexture(key, 32, 32);
  graphics.destroy();
}

/** Generate placeholders for every sprite key found in JSON. */
export function createPlaceholderTextures(scene: Phaser.Scene): void {
  const content = getCatalog();
  for (const hero of Object.values(content.heroes)) {
    square(scene, hero.sprite, 16, 0x9acb9b);
  }
  for (const enemy of Object.values(content.enemies)) {
    square(scene, enemy.sprite, 16,
      colorFor(enemy.id, [0xb97759, 0x9d7563, 0x928b62]));
  }
  for (const weapon of Object.values(content.weapons)) {
    square(scene, weapon.sprite, 8,
      colorFor(weapon.id, [0xb8aa7b, 0x986c55]));
    square(scene, weapon.projectileSprite, 4,
      colorFor(weapon.id, [0xece1a3, 0xe0b783]));
  }
  square(scene, 'xp/green', 6, 0x93d9b0);
  for (const location of Object.values(content.locations)) {
    ground(scene, location.groundSprite);
  }
}

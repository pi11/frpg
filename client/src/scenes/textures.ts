import * as Phaser from 'phaser';

function square(scene: Phaser.Scene, key: string, size: number, color: number): void {
  const graphics = scene.make.graphics({ x: 0, y: 0 });
  graphics.fillStyle(color);
  graphics.fillRect(0, 0, size, size);
  graphics.generateTexture(key, size, size);
  graphics.destroy();
}

export function createPlaceholderTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('hero')) return;
  square(scene, 'hero', 16, 0x9acb9b);
  square(scene, 'enemy', 16, 0xb97759);
  square(scene, 'projectile', 4, 0xece1a3);
  square(scene, 'xp', 6, 0x93d9b0);

  const ground = scene.make.graphics({ x: 0, y: 0 });
  ground.fillStyle(0x4a4034);
  ground.fillRect(0, 0, 32, 32);
  ground.fillStyle(0x574b3a);
  ground.fillRect(0, 0, 16, 16);
  ground.fillRect(16, 16, 16, 16);
  ground.generateTexture('ground', 32, 32);
  ground.destroy();
}

import type * as Phaser from 'phaser';
import { ATLAS } from '../assets';
import type { LocationDefinition } from '../content/schemas';
import { rollRange } from '../behaviors/types';
import { Rng } from './rng';

type Decor = LocationDefinition['decor'];

/** Mix the run seed with chunk coordinates (integer hash, no allocations). */
export function chunkSeed(seed: number, cx: number, cy: number): number {
  let hash = (seed ^ 0x9e3779b9) >>> 0;
  hash = Math.imul(hash ^ (cx | 0), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13) ^ (cy | 0), 0xc2b2ae35) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

export interface DecorItem {
  kind: 'patch' | 'object' | 'crate';
  sprite: string;
  x: number;
  y: number;
  /** Stable id of a crate, so a broken crate never comes back. */
  key: string;
}

function weighted(items: readonly { sprite: string; weight: number }[], random: number): string {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = random * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll < 0) return item.sprite;
  }
  return items.at(-1)!.sprite;
}

/** Pure, deterministic contents of one chunk (unit-tested). */
export function generateChunk(seed: number, cx: number, cy: number, decor: Decor): DecorItem[] {
  const rng = new Rng(chunkSeed(seed, cx, cy));
  const size = decor.chunkSize;
  const items: DecorItem[] = [];
  const place = (kind: DecorItem['kind'], sprite: string, index: number): void => {
    items.push({
      kind, sprite, key: `${cx},${cy},${kind},${index}`,
      x: Math.round(cx * size + rng.next() * size),
      y: Math.round(cy * size + rng.next() * size),
    });
  };
  const patches = rollRange(decor.patches.perChunk, rng.next());
  for (let index = 0; index < patches; index += 1) {
    place('patch', weighted(decor.patches.items, rng.next()), index);
  }
  const objects = rollRange(decor.objects.perChunk, rng.next());
  for (let index = 0; index < objects; index += 1) {
    place('object', weighted(decor.objects.items, rng.next()), index);
  }
  const crates = rollRange(decor.crates.perChunk, rng.next());
  for (let index = 0; index < crates; index += 1) place('crate', decor.crates.sprite, index);
  return items;
}

/**
 * Streams decor around the camera: chunks within one chunk of the view exist, farther
 * chunks return their sprites to the pools. Patches lie flat under everything, objects
 * sit under actors, crates are physics bodies that projectiles and the hero can break.
 */
export class WorldDecor {
  private readonly loaded = new Map<string, Phaser.GameObjects.GameObject[]>();
  private readonly broken = new Set<string>();
  private readonly images: Phaser.GameObjects.Image[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly seed: number,
    private readonly decor: Decor,
    private readonly crates: Phaser.Physics.Arcade.Group,
  ) {}

  update(view: Phaser.Geom.Rectangle): void {
    const size = this.decor.chunkSize;
    const minX = Math.floor(view.x / size) - 1;
    const maxX = Math.floor((view.x + view.width) / size) + 1;
    const minY = Math.floor(view.y / size) - 1;
    const maxY = Math.floor((view.y + view.height) / size) + 1;
    for (const [key, objects] of this.loaded) {
      const [cx, cy] = key.split(',').map(Number) as [number, number];
      if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) continue;
      for (const object of objects) this.release(object);
      this.loaded.delete(key);
    }
    for (let cx = minX; cx <= maxX; cx += 1) {
      for (let cy = minY; cy <= maxY; cy += 1) {
        const key = `${cx},${cy}`;
        if (!this.loaded.has(key)) this.loaded.set(key, this.spawnChunk(cx, cy));
      }
    }
  }

  /** Remember the crate as broken and hide it. */
  breakCrate(crate: Phaser.Physics.Arcade.Sprite): void {
    this.broken.add(crate.getData('decorKey') as string);
    const chunk = this.loaded.get(crate.getData('chunkKey') as string);
    if (chunk) chunk.splice(chunk.indexOf(crate), 1);
    crate.disableBody(true, true);
  }

  private spawnChunk(cx: number, cy: number): Phaser.GameObjects.GameObject[] {
    const objects: Phaser.GameObjects.GameObject[] = [];
    for (const item of generateChunk(this.seed, cx, cy, this.decor)) {
      if (item.kind === 'crate') {
        if (this.broken.has(item.key)) continue;
        const crate = this.crates.getFirstDead(false) as Phaser.Physics.Arcade.Sprite | null;
        if (!crate) continue;
        crate.setTexture(ATLAS, item.sprite);
        crate.enableBody(true, item.x, item.y, true, true);
        crate.setData('decorKey', item.key).setData('chunkKey', `${cx},${cy}`)
          .setData('hp', this.decor.crates.hp);
        objects.push(crate);
        continue;
      }
      const image = this.images.find((candidate) => !candidate.active)
        ?? this.newImage();
      image.setActive(true).setVisible(true).setFrame(item.sprite).setPosition(item.x, item.y)
        .setDepth(item.kind === 'patch' ? -90 : -20 + item.y / 100000);
      objects.push(image);
    }
    return objects;
  }

  private newImage(): Phaser.GameObjects.Image {
    // Pool growth happens only when a new chunk needs more images than ever before.
    const image = this.scene.add.image(0, 0, ATLAS, 'decor/rocks');
    this.images.push(image);
    return image;
  }

  private release(object: Phaser.GameObjects.GameObject): void {
    if (this.crates.contains(object)) {
      const crate = object as Phaser.Physics.Arcade.Sprite;
      if (crate.active) crate.disableBody(true, true);
      return;
    }
    (object as Phaser.GameObjects.Image).setActive(false).setVisible(false);
  }
}

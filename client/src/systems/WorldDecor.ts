import type * as Phaser from 'phaser';
import { ATLAS } from '../assets';
import type { LandmarkChoice, LandmarkDefinition, LocationDefinition, StructureDefinition } from '../content/schemas';
import type { Catalog } from '../content/catalog';
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
  kind: 'patch' | 'object' | 'crate' | 'landmark';
  /** Atlas frame; for a landmark its content id. */
  sprite: string;
  x: number;
  y: number;
  /** Stable id, so a broken crate or a used landmark stays that way. */
  key: string;
}

/** No structures or hazards this close to the start of the run. */
const SAFE_START = 110;

function weighted<T extends { weight: number }>(items: readonly T[], random: number): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = random * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll < 0) return item;
  }
  return items.at(-1)!;
}

/** Biome of a chunk: neighbouring chunks in one region share it. */
export function biomeAt(seed: number, cx: number, cy: number, decor: Decor): Decor['biomes'][number] {
  const region = decor.biomeChunks;
  const hash = chunkSeed(seed ^ 0x5bd1e995, Math.floor(cx / region), Math.floor(cy / region));
  return weighted(decor.biomes, new Rng(hash).next());
}

/**
 * The hand-made structure of a chunk and its centre, or null; the same rolls generateChunk
 * makes first, so it agrees with the map without building the chunk.
 */
export function structureAt(seed: number, cx: number, cy: number, decor: Decor): { id: string; x: number; y: number } | null {
  const rng = new Rng(chunkSeed(seed, cx, cy));
  const size = decor.chunkSize;
  const x = (cx + 0.5) * size;
  const y = (cy + 0.5) * size;
  if (rng.next() >= decor.structures.chance || Math.hypot(x, y) <= size) return null;
  return { id: weighted(decor.structures.items, rng.next()).structure, x, y };
}

/** Pure, deterministic contents of one chunk (unit-tested). */
export function generateChunk(
  seed: number, cx: number, cy: number, decor: Decor,
  structures: Readonly<Record<string, StructureDefinition>>,
): DecorItem[] {
  const rng = new Rng(chunkSeed(seed, cx, cy));
  const size = decor.chunkSize;
  const biome = biomeAt(seed, cx, cy, decor);
  const hazards = new Set(decor.hazards.map((hazard) => hazard.sprite));
  const items: DecorItem[] = [];
  const add = (kind: DecorItem['kind'], sprite: string, x: number, y: number): void => {
    if (hazards.has(sprite) && Math.hypot(x, y) < SAFE_START) return;
    items.push({ kind, sprite, key: `${cx},${cy},${items.length}`, x: Math.round(x), y: Math.round(y) });
  };
  const scatter = (kind: DecorItem['kind'], sprite: string): void => {
    add(kind, sprite, (cx + rng.next()) * size, (cy + rng.next()) * size);
  };
  const hasStructure = rng.next() < decor.structures.chance;
  const centerX = (cx + 0.5) * size;
  const centerY = (cy + 0.5) * size;
  if (hasStructure && Math.hypot(centerX, centerY) > size) {
    const picked = weighted(decor.structures.items, rng.next()).structure;
    for (const item of structures[picked]!.items) {
      const sprite = item.kind === 'crate' ? decor.crates.sprite
        : item.kind === 'landmark' ? item.landmark : item.sprite;
      add(item.kind, sprite, centerX + item.x, centerY + item.y);
    }
    // Keep hand-made places readable: no random patches or objects on them.
    return items;
  }
  const patches = rollRange(biome.patches.perChunk, rng.next());
  for (let index = 0; index < patches; index += 1) {
    scatter('patch', weighted(biome.patches.items, rng.next()).sprite);
  }
  const objects = rollRange(biome.objects.perChunk, rng.next());
  for (let index = 0; index < objects; index += 1) {
    scatter('object', weighted(biome.objects.items, rng.next()).sprite);
  }
  const crates = rollRange(decor.crates.perChunk, rng.next());
  for (let index = 0; index < crates; index += 1) scatter('crate', decor.crates.sprite);
  return items;
}

/** A landmark near the hero; `progress` is 0..1 of the hold time. */
export interface ActiveLandmark {
  readonly key: string;
  readonly definition: LandmarkDefinition;
  readonly x: number;
  readonly y: number;
  readonly image: Phaser.GameObjects.Image;
  used: boolean;
  progress: number;
  /** The card taken at a landmark with choices; kept for the whole run, also when its chunk reloads. */
  choice: LandmarkChoice['id'] | null;
}

export interface ActiveHazard {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly damagePerSecond: number;
  readonly slow: number;
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
  private readonly used = new Set<string>();
  private readonly chosen = new Map<string, LandmarkChoice['id']>();
  private readonly hazardsBySprite: Map<string, Decor['hazards'][number]>;
  private readonly activeLandmarks = new Map<string, ActiveLandmark[]>();
  private readonly activeHazards = new Map<string, ActiveHazard[]>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly seed: number,
    private readonly decor: Decor,
    private readonly crates: Phaser.Physics.Arcade.Group,
    private readonly catalog: Pick<Catalog, 'landmarks' | 'structures'>,
  ) {
    this.hazardsBySprite = new Map(decor.hazards.map((hazard) => [hazard.sprite, hazard]));
  }

  /** Calls back for every landmark in the loaded chunks. */
  eachLandmark(visit: (landmark: ActiveLandmark) => void): void {
    for (const list of this.activeLandmarks.values()) list.forEach(visit);
  }

  /** Damage per second and slow of the hazards under a point (the strongest of each). */
  hazardAt(x: number, y: number): { damagePerSecond: number; slow: number } {
    let damagePerSecond = 0;
    let slow = 0;
    for (const list of this.activeHazards.values()) {
      for (const hazard of list) {
        const dx = hazard.x - x;
        const dy = hazard.y - y;
        if (dx * dx + dy * dy > hazard.radius * hazard.radius) continue;
        damagePerSecond = Math.max(damagePerSecond, hazard.damagePerSecond);
        slow = Math.max(slow, hazard.slow);
      }
    }
    return { damagePerSecond, slow };
  }

  /** Fixes the card for this landmark; false when one was taken before. */
  chooseLandmark(landmark: ActiveLandmark, choice: LandmarkChoice['id']): boolean {
    if (this.chosen.has(landmark.key) || this.used.has(landmark.key)) return false;
    this.chosen.set(landmark.key, choice);
    landmark.choice = choice;
    return true;
  }

  useLandmark(landmark: ActiveLandmark): void {
    this.used.add(landmark.key);
    landmark.used = true;
    landmark.image.setFrame(`${landmark.definition.sprite}_used`);
  }

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
      this.activeLandmarks.delete(key);
      this.activeHazards.delete(key);
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
    const landmarks: ActiveLandmark[] = [];
    const hazards: ActiveHazard[] = [];
    for (const item of generateChunk(this.seed, cx, cy, this.decor, this.catalog.structures)) {
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
      const landmark = item.kind === 'landmark' ? this.catalog.landmarks[item.sprite]! : undefined;
      const used = this.used.has(item.key);
      const frame = landmark ? `${landmark.sprite}${used ? '_used' : ''}` : item.sprite;
      image.setActive(true).setVisible(true).setFrame(frame).setPosition(item.x, item.y)
        .setDepth(item.kind === 'patch' ? -90 : -20 + item.y / 100000);
      objects.push(image);
      if (landmark) {
        landmarks.push({ key: item.key, definition: landmark, x: item.x, y: item.y, image, used, progress: 0,
          choice: this.chosen.get(item.key) ?? null });
      }
      const hazard = item.kind === 'patch' ? this.hazardsBySprite.get(item.sprite) : undefined;
      if (hazard) hazards.push({ ...hazard, x: item.x, y: item.y });
    }
    if (landmarks.length) this.activeLandmarks.set(`${cx},${cy}`, landmarks);
    if (hazards.length) this.activeHazards.set(`${cx},${cy}`, hazards);
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

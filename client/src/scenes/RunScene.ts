import * as Phaser from 'phaser';
import { animationKey, ATLAS } from '../assets';
import { enemyBehaviors, pickupEffects, weaponBehaviors } from '../behaviors/registry';
import type {
  CombatContext, EnemyContext, HitLimit, Mob, PickupContext, Point, ProjectileSpec, WeaponState,
  ZoneSpec,
} from '../behaviors/types';
import { getCatalog } from '../content/catalog';
import type { Catalog } from '../content/catalog';
import type {
  EnemyDefinition, HeroDefinition, LocationDefinition, StatKey,
} from '../content/schemas';
import { inputState } from '../inputState';
import { playMusic, playSfx } from '../sound';
import { Rng } from '../systems/rng';
import { availableEvolutions, evolutionSource } from '../systems/evolutions';
import { COLORS, textStyle } from '../ui/theme';
import { WorldDecor } from '../systems/WorldDecor';
import type { ResultData } from './ResultScene';

export interface RunView {
  hp: number;
  maxHp: number;
  xp: number;
  nextXp: number;
  level: number;
  kills: number;
  caps: number;
  seconds: number;
  wave: number;
  enemyCount: number;
  projectileCount: number;
  seed: number;
  /** Strongest living elite or boss, for the HUD bar. */
  boss: { name: string; fraction: number } | null;
  /** Banner text shown before an elite or the boss arrives. */
  warning: string;
}

export interface UpgradeChoice {
  kind: 'weapon' | 'passive' | 'evolution';
  id: string;
  name: string;
  description: string;
  sprite: string;
}

export interface ChestData {
  granted: UpgradeChoice[];
  caps: number;
}

export interface RunData {
  seed: number;
  locationId: string;
  heroId: string;
  wave: number;
  runId: string;
  contentHash: string;
  /** Shelter upgrade levels from the server profile. */
  upgrades: Record<string, number>;
}

/** Presentation constants (not balance). */
const EFFECT_POOL_SIZE = 128;
const FLAMES_PER_ZONE = 7;
const HERO_DEATH_DELAY_MS = 900;
const VICTORY_DELAY_MS = 1800;
const SUMMON_RING = 36;
const HIT_FLASH_MS = 50;
const LABEL_POOL_SIZE = 8;
const HIT_FLASH_GAP_MS = 120;

/** Adapts a pooled enemy sprite to the Mob interface used by AI behaviors. */
class SpriteMob implements Mob {
  readonly memory: Record<string, number> = {};
  readonly hitAt: Record<string, number> = {};
  definition!: EnemyDefinition;
  hp = 0;
  maxHp = 1;
  speedMultiplier = 1;
  telegraphing = false;
  /** Run time when the white hit flash ends (0 = no flash). */
  flashUntil = 0;

  constructor(readonly sprite: Phaser.Physics.Arcade.Sprite, readonly uid: number) {}

  get x(): number { return this.sprite.x; }
  get y(): number { return this.sprite.y; }
  get velocityX(): number { return (this.sprite.body as Phaser.Physics.Arcade.Body).velocity.x; }
  get velocityY(): number { return (this.sprite.body as Phaser.Physics.Arcade.Body).velocity.y; }
  get speed(): number { return this.definition.stats.speed * this.speedMultiplier; }
  get hpFraction(): number { return Math.max(0, this.hp / this.maxHp); }

  setVelocity(x: number, y: number): void { this.sprite.setVelocity(x, y); }

  telegraph(on: boolean): void {
    this.telegraphing = on;
    if (on) this.sprite.setTint(0xff6a4a).setTintMode(Phaser.TintModes.MULTIPLY);
    else this.sprite.clearTint();
  }

  reset(definition: EnemyDefinition, hp: number, speedMultiplier: number): void {
    this.definition = definition;
    this.speedMultiplier = speedMultiplier;
    this.hp = hp;
    this.maxHp = hp;
    this.telegraphing = false;
    this.flashUntil = 0;
    for (const key of Object.keys(this.memory)) this.memory[key] = 0;
    for (const key of Object.keys(this.hitAt)) this.hitAt[key] = -Infinity;
  }
}

interface Zone extends ZoneSpec {
  active: boolean;
  nextTick: number;
  until: number;
  flames: Phaser.GameObjects.Sprite[];
}

export class RunScene extends Phaser.Scene {
  readonly view: RunView = {
    hp: 0, maxHp: 0, xp: 0, nextXp: 0, level: 1, kills: 0, caps: 0, seconds: 0,
    wave: 1, enemyCount: 0, projectileCount: 0, seed: 0, boss: null, warning: '',
  };
  choices: UpgradeChoice[] = [];
  chest: ChestData = { granted: [], caps: 0 };

  private catalog!: Catalog;
  private heroDefinition!: HeroDefinition;
  private location!: LocationDefinition;
  private hero!: Phaser.Physics.Arcade.Sprite;
  private enemies!: Phaser.Physics.Arcade.Group;
  private projectiles!: Phaser.Physics.Arcade.Group;
  private hostileShots!: Phaser.Physics.Arcade.Group;
  private crystals!: Phaser.Physics.Arcade.Group;
  private pickups!: Phaser.Physics.Arcade.Group;
  private crates!: Phaser.Physics.Arcade.Group;
  private decor!: WorldDecor;
  private ground!: Phaser.GameObjects.TileSprite;
  /** Death puffs, sparks and explosions: a fixed pool of plain sprites. */
  private effects!: Phaser.GameObjects.Group;
  private areaGraphics!: Phaser.GameObjects.Graphics;
  /** Small rising labels for collected loot. */
  private labels: Phaser.GameObjects.Text[] = [];
  private zones: Zone[] = [];
  private orbiters = new Map<string, Phaser.GameObjects.Sprite[]>();
  private auras = new Map<string, number>();
  private mobs: SpriteMob[] = [];
  private spawnCount = 0;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private rng!: Rng;
  private combat!: CombatContext;
  private enemyContext!: EnemyContext;
  private pickupContext!: PickupContext;
  private weapons = new Map<string, WeaponState>();
  private ownedPassives = new Map<string, number>();
  private shelterUpgrades: Record<string, number> = {};
  private killsByType: Record<string, number> = {};
  private runId = '';
  private contentHash = '';
  private waveIndex = 0;
  private eventIndex = 0;
  private bossSpawned = false;
  private bossKilled = false;
  private warningUntil = 0;
  private elapsedMs = 0;
  private spawnClock = 0;
  private lastDamageAt = -Infinity;
  private finished = false;

  constructor() {
    super('Run');
  }

  init(data: RunData): void {
    this.catalog = getCatalog();
    const location = this.catalog.locations[data.locationId];
    const hero = this.catalog.heroes[data.heroId];
    if (!location || !hero) throw new Error('Unknown location or hero');
    this.location = location;
    this.heroDefinition = hero;
    this.rng = new Rng(data.seed);
    this.weapons = new Map([[hero.startingWeapon, this.newWeaponState()]]);
    this.ownedPassives = new Map();
    this.shelterUpgrades = { ...data.upgrades };
    this.killsByType = {};
    this.runId = data.runId;
    this.contentHash = data.contentHash;
    this.waveIndex = Math.min(data.wave, location.waves.length - 1);
    this.elapsedMs = location.waves[this.waveIndex]!.atSecond * 1000;
    this.eventIndex = location.events.filter((event) => event.atSecond * 1000 < this.elapsedMs).length;
    this.bossSpawned = false;
    this.bossKilled = false;
    this.warningUntil = 0;
    this.spawnClock = 0;
    this.lastDamageAt = -Infinity;
    this.finished = false;
    this.choices = [];
    this.zones = [];
    this.orbiters = new Map();
    this.auras = new Map();
    this.mobs = [];
    Object.assign(this.view, {
      hp: this.stat('maxHp'), maxHp: this.stat('maxHp'), xp: 0,
      nextXp: this.catalog.balance.xp.base, level: 1, kills: 0, caps: 0,
      seconds: Math.floor(this.elapsedMs / 1000), wave: this.waveIndex + 1,
      enemyCount: 0, projectileCount: 0, seed: data.seed, boss: null, warning: '',
    });
    inputState.x = 0;
    inputState.y = 0;
  }

  create(): void {
    const limits = this.catalog.balance.run;
    this.physics.world.setBounds(-100000, -100000, 200000, 200000);
    this.ground = this.add.tileSprite(0, 0, 480, 270, this.location.groundSprite)
      .setOrigin(0).setScrollFactor(0).setDepth(-100);
    this.hero = this.physics.add.sprite(0, 0, ATLAS, this.heroDefinition.sprite).setDepth(10);
    (this.hero.body as Phaser.Physics.Arcade.Body).setSize(12, 12);
    this.cameras.main.startFollow(this.hero, true);
    this.cameras.main.setRoundPixels(true);

    const firstEnemy = Object.values(this.catalog.enemies)[0]!;
    this.enemies = this.createPool(firstEnemy.sprite, limits.enemyLimit);
    this.enemies.getChildren().forEach((item, index) => {
      const sprite = item as Phaser.Physics.Arcade.Sprite;
      const mob = new SpriteMob(sprite, index);
      sprite.setData('mob', mob);
      this.mobs.push(mob);
    });
    this.projectiles = this.createPool('projectiles/bullet', limits.projectileLimit);
    this.projectiles.getChildren().forEach((item) => (item as Phaser.GameObjects.Sprite)
      .setData('hits', new Set<number>()).setDepth(8));
    this.hostileShots = this.createPool('projectiles/slug', limits.enemyProjectileLimit);
    this.crystals = this.createPool('xp/green', limits.xpLimit);
    this.pickups = this.createPool('pickups/cap', limits.pickupLimit);
    this.crates = this.createPool(this.location.decor.crates.sprite, limits.crateLimit);
    this.crates.getChildren().forEach((item) => {
      (item as Phaser.Physics.Arcade.Sprite).setDepth(-10).setImmovable(true);
    });
    this.decor = new WorldDecor(this, this.view.seed, this.location.decor, this.crates);

    this.effects = this.add.group({ maxSize: EFFECT_POOL_SIZE });
    for (let index = 0; index < EFFECT_POOL_SIZE; index += 1) {
      const effect = this.add.sprite(0, 0, ATLAS, 'fx/hit').setDepth(12);
      effect.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        effect.setActive(false).setVisible(false);
      });
      this.effects.add(effect.setActive(false).setVisible(false));
    }
    this.areaGraphics = this.add.graphics().setDepth(-5);
    this.labels = Array.from({ length: LABEL_POOL_SIZE }, () =>
      this.add.text(0, 0, '', textStyle(8, COLORS.bright)).setOrigin(0.5).setDepth(30).setVisible(false));
    for (let index = 0; index < limits.zoneLimit; index += 1) {
      const flames = Array.from({ length: FLAMES_PER_ZONE }, () =>
        this.add.sprite(0, 0, ATLAS, 'fx/fire').setDepth(-4).setVisible(false));
      this.zones.push({
        active: false, x: 0, y: 0, radius: 0, damage: 0, tickMs: 1, durationMs: 0,
        sprite: 'fx/fire', nextTick: 0, until: 0, flames,
      });
    }
    this.createContexts();

    this.physics.add.overlap(this.projectiles, this.enemies, (first, second) => {
      const bullet = first as Phaser.Physics.Arcade.Sprite;
      const mob = (second as Phaser.Physics.Arcade.Sprite).getData('mob') as SpriteMob;
      if (!bullet.active || !mob.sprite.active) return;
      const hits = bullet.getData('hits') as Set<number>;
      if (hits.has(mob.uid)) return;
      hits.add(mob.uid);
      this.consumeBullet(bullet);
      this.damageMob(mob, bullet.getData('damage') as number, bullet.x, bullet.y);
    });
    this.physics.add.overlap(this.projectiles, this.crates, (first, second) => {
      const bullet = first as Phaser.Physics.Arcade.Sprite;
      const crate = second as Phaser.Physics.Arcade.Sprite;
      if (!bullet.active || !crate.active) return;
      this.consumeBullet(bullet);
      this.hitCrate(crate, bullet.getData('damage') as number);
    });
    this.physics.add.overlap(this.hero, this.crates, (_hero, crate) => {
      const sprite = crate as Phaser.Physics.Arcade.Sprite;
      if (sprite.active) this.hitCrate(sprite, Infinity);
    });
    this.physics.add.overlap(this.hero, this.enemies, (_hero, item) => {
      const sprite = item as Phaser.Physics.Arcade.Sprite;
      if (!sprite.active) return;
      this.takeDamage((sprite.getData('mob') as SpriteMob).definition.stats.damage);
    });
    this.physics.add.overlap(this.hero, this.hostileShots, (_hero, item) => {
      const shot = item as Phaser.Physics.Arcade.Sprite;
      if (!shot.active) return;
      shot.disableBody(true, true);
      this.takeDamage(shot.getData('damage') as number);
    });

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.keys;
    this.scene.launch('Hud');
    this.scene.bringToTop('Hud');
    playSfx('sfx/run_start');
    playMusic(this.location.music);
  }

  // --- contexts handed to behaviors ---------------------------------------------------

  private createContexts(): void {
    this.combat = {
      hero: this.hero,
      now: this.elapsedMs,
      rng: () => this.rng.next(),
      stat: (key) => this.stat(key),
      nearestEnemy: () => this.nearestEnemy(),
      randomEnemyWithin: (range) => this.randomEnemyWithin(range),
      damageInRadius: (center, radius, damage, limit) => this.damageInRadius(center, radius, damage, limit),
      spawnProjectile: (spec) => this.spawnProjectile(spec),
      spawnZone: (spec) => this.spawnZone(spec),
      placeOrbiters: (owner, sprite, positions) => this.placeOrbiters(owner, sprite, positions),
      showAura: (owner, radius) => { this.auras.set(owner, radius); },
    };
    this.enemyContext = {
      hero: this.hero,
      now: this.elapsedMs,
      shoot: (from, vx, vy, damage, sprite, lifetimeMs) => {
        const shot = this.hostileShots.getFirstDead(false) as Phaser.Physics.Arcade.Sprite | null;
        if (!shot) return;
        shot.setTexture(ATLAS, sprite).enableBody(true, from.x, from.y, true, true);
        shot.setVelocity(vx, vy).setRotation(Math.atan2(vy, vx)).setDepth(9);
        shot.setData('damage', damage).setData('expiresAt', this.elapsedMs + lifetimeMs);
        playSfx('sfx/enemy_shot', 0.5);
      },
      explode: (mob, radius, damage) => {
        const sprite = (mob as SpriteMob).sprite;
        this.playEffect('fx/explosion', 'burst', sprite.x, sprite.y, false);
        playSfx('sfx/explosion');
        if (Phaser.Math.Distance.Between(sprite.x, sprite.y, this.hero.x, this.hero.y) <= radius) {
          this.takeDamage(damage, true);
        }
        sprite.clearTint();
        sprite.disableBody(true, true);
      },
      summon: (enemyId, count, around) => {
        const definition = this.catalog.enemies[enemyId];
        if (!definition) return;
        for (let index = 0; index < count; index += 1) {
          const angle = (index / count) * Math.PI * 2;
          this.spawnEnemy(definition, around.x + Math.cos(angle) * SUMMON_RING,
            around.y + Math.sin(angle) * SUMMON_RING, this.currentWave().hpMultiplier);
        }
      },
    };
    this.pickupContext = {
      rng: () => this.rng.next(),
      luck: () => this.stat('luck'),
      hero: this.hero,
      heal: (fraction) => {
        this.view.hp = Math.min(this.view.maxHp, this.view.hp + this.view.maxHp * fraction);
        this.hero.setTint(0x9bff6e);
        this.time.delayedCall(180, () => this.hero.clearTint());
      },
      attractAll: () => {
        for (const group of [this.crystals, this.pickups]) {
          for (const item of group.getChildren()) {
            const sprite = item as Phaser.Physics.Arcade.Sprite;
            if (sprite.active && this.isAttracting(sprite)) sprite.setData('pulled', true);
          }
        }
      },
      blast: (center, radius, damage) => {
        this.cameras.main.flash(160, 220, 255, 200);
        this.playEffect('fx/explosion', 'burst', center.x, center.y, false);
        this.damageInRadius(center, radius, damage);
      },
      addCaps: (amount) => { this.view.caps += amount; },
      openChest: (items, caps) => this.openChest(items, caps),
    };
  }

  // --- loop --------------------------------------------------------------------------

  update(_time: number, delta: number): void {
    if (this.finished) return;
    this.elapsedMs += delta;
    this.combat.now = this.elapsedMs;
    this.enemyContext.now = this.elapsedMs;
    this.view.seconds = Math.floor(this.elapsedMs / 1000);
    if (this.view.seconds >= this.location.durationSeconds) {
      this.finish('survived');
      return;
    }
    while (true) {
      const nextWave = this.location.waves[this.waveIndex + 1];
      if (!nextWave || nextWave.atSecond > this.view.seconds) break;
      this.waveIndex += 1;
      this.view.wave = this.waveIndex + 1;
      this.spawnClock = 0;
    }
    this.runTimeline();

    const regen = this.stat('regen');
    if (regen > 0) this.view.hp = Math.min(this.view.maxHp, this.view.hp + regen * delta / 1000);
    this.moveHero();
    const camera = this.cameras.main;
    this.ground.tilePositionX = camera.scrollX;
    this.ground.tilePositionY = camera.scrollY;
    this.decor.update(camera.worldView);

    const interval = this.currentWave().spawnIntervalMs;
    this.spawnClock += delta;
    while (this.spawnClock >= interval) {
      this.spawnClock -= interval;
      this.spawnEnemy(this.selectEnemy());
    }
    this.moveEnemies(delta);
    this.expire(this.projectiles);
    this.expire(this.hostileShots);
    this.updateZones();
    this.updateLoot();
    this.auras.clear();
    this.updateWeapons(delta);
    this.drawAreas();
    this.view.enemyCount = this.enemies.countActive();
    this.view.projectileCount = this.projectiles.countActive();
    this.view.boss = this.strongestElite();
    if (this.elapsedMs >= this.warningUntil) this.view.warning = '';
  }

  private currentWave(): LocationDefinition['waves'][number] {
    return this.location.waves[this.waveIndex]!;
  }

  private runTimeline(): void {
    const warning = this.catalog.balance.run.eliteWarningSeconds;
    const seconds = this.elapsedMs / 1000;
    const event = this.location.events[this.eventIndex];
    if (event) {
      const definition = this.catalog.enemies[event.enemy]!;
      if (seconds >= event.atSecond - warning && seconds < event.atSecond) {
        this.warn(`!! ${definition.name.toUpperCase()} !!`);
      }
      if (seconds >= event.atSecond) {
        this.eventIndex += 1;
        for (let index = 0; index < event.count; index += 1) this.spawnEnemy(definition);
      }
    }
    const boss = this.location.boss;
    if (!this.bossSpawned) {
      const definition = this.catalog.enemies[boss.enemy]!;
      if (seconds >= boss.atSecond - warning && seconds < boss.atSecond) {
        this.warn(`!!! ${definition.name.toUpperCase()} !!!`);
      }
      if (seconds >= boss.atSecond) {
        this.bossSpawned = true;
        this.spawnEnemy(definition);
        playMusic(this.location.bossMusic);
      }
    }
  }

  private warn(text: string): void {
    if (this.view.warning !== text) playSfx('sfx/warning');
    this.view.warning = text;
    this.warningUntil = this.elapsedMs + 500;
  }

  stat(key: StatKey): number {
    let flat = 0;
    let percent = 0;
    for (const [id, level] of this.ownedPassives) {
      const passive = this.catalog.passives[id]!;
      if (passive.stat !== key) continue;
      if (passive.mod === 'flat') flat += passive.perLevel * level;
      else percent += passive.perLevel * level;
    }
    for (const [id, level] of Object.entries(this.shelterUpgrades)) {
      const upgrade = this.catalog.upgrades[id];
      if (!upgrade || upgrade.stat !== key) continue;
      if (upgrade.mod === 'flat') flat += upgrade.perLevel * level;
      else percent += upgrade.perLevel * level;
    }
    return (this.heroDefinition.baseStats[key] + flat) * (1 + percent);
  }

  private moveHero(): void {
    let x = inputState.x;
    let y = inputState.y;
    if (this.keys.A.isDown || this.cursors.left.isDown) x -= 1;
    if (this.keys.D.isDown || this.cursors.right.isDown) x += 1;
    if (this.keys.W.isDown || this.cursors.up.isDown) y -= 1;
    if (this.keys.S.isDown || this.cursors.down.isDown) y += 1;
    const length = Math.hypot(x, y);
    const speed = this.stat('moveSpeed');
    this.hero.setVelocity(length > 0 ? (x / length) * speed : 0,
      length > 0 ? (y / length) * speed : 0);
    const sprite = this.heroDefinition.sprite;
    if (length > 0) {
      if (x !== 0) this.hero.setFlipX(x < 0);
      this.hero.anims.play(animationKey(sprite, 'walk'), true);
    } else if (this.hero.anims.isPlaying) {
      this.hero.anims.stop();
      this.hero.setFrame(sprite);
    }
  }

  // --- enemies -----------------------------------------------------------------------

  private selectEnemy(): EnemyDefinition {
    const entries = this.currentWave().enemies;
    let total = 0;
    for (const entry of entries) total += entry.weight;
    let roll = this.rng.next() * total;
    for (const entry of entries) {
      roll -= entry.weight;
      if (roll < 0) return this.catalog.enemies[entry.id]!;
    }
    return this.catalog.enemies[entries.at(-1)!.id]!;
  }

  private spawnEnemy(definition: EnemyDefinition, x?: number, y?: number, hpMultiplier?: number): void {
    const sprite = this.enemies.getFirstDead(false) as Phaser.Physics.Arcade.Sprite | null;
    if (!sprite) return;
    if (x === undefined || y === undefined) {
      const angle = this.rng.next() * Math.PI * 2;
      const distance = this.catalog.balance.run.spawnDistance;
      x = this.hero.x + Math.cos(angle) * distance;
      y = this.hero.y + Math.sin(angle) * distance;
    }
    const multiplier = hpMultiplier ?? (definition.role === 'normal' ? this.currentWave().hpMultiplier : 1);
    sprite.setTexture(ATLAS, definition.sprite).clearTint();
    sprite.enableBody(true, x, y, true, true);
    (sprite.body as Phaser.Physics.Arcade.Body).setSize(sprite.width * 0.8, sprite.height * 0.8);
    sprite.setVelocity(0, 0).setDepth(definition.role === 'normal' ? 0 : 6);
    const speed = definition.role === 'normal' ? this.currentWave().speedMultiplier : 1;
    (sprite.getData('mob') as SpriteMob).reset(definition, definition.stats.hp * multiplier, speed);
    const walk = animationKey(definition.sprite, 'walk');
    if (this.anims.exists(walk)) {
      // Visual-only phase offset: a counter, so the seeded gameplay RNG stream is untouched.
      this.spawnCount += 1;
      sprite.anims.play({ key: walk, startFrame: this.spawnCount % 4 });
    }
  }

  private moveEnemies(delta: number): void {
    const maxDistanceSquared = this.catalog.balance.run.despawnDistance ** 2;
    for (const mob of this.mobs) {
      const sprite = mob.sprite;
      if (!sprite.active) continue;
      const dx = this.hero.x - sprite.x;
      const dy = this.hero.y - sprite.y;
      if (mob.definition.role === 'normal' && dx * dx + dy * dy > maxDistanceSquared) {
        sprite.disableBody(true, true);
        continue;
      }
      sprite.setFlipX(dx < 0);
      if (mob.flashUntil && this.elapsedMs >= mob.flashUntil) {
        mob.flashUntil = 0;
        if (!mob.telegraphing) sprite.clearTint();
      }
      const definition = mob.definition;
      enemyBehaviors[definition.ai.type]!.update(mob, this.enemyContext, definition.ai.params, delta);
    }
  }

  private damageMob(mob: SpriteMob, amount: number, x: number, y: number): void {
    mob.hp -= amount;
    if (mob.hp <= 0) {
      this.killMob(mob);
      return;
    }
    this.playEffect('fx/hit', 'burst', x, y, false);
    playSfx('sfx/enemy_hit', 0.6);
    // Leave a gap between flashes so constant fire (aura, drones) does not keep it white.
    if (!mob.telegraphing && this.elapsedMs >= mob.flashUntil + HIT_FLASH_GAP_MS) {
      mob.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      mob.flashUntil = this.elapsedMs + HIT_FLASH_MS;
    }
  }

  private killMob(mob: SpriteMob): void {
    const { sprite, definition } = mob;
    const { x, y } = sprite;
    this.playEffect(definition.sprite, 'death', x, y, sprite.flipX);
    if (definition.role === 'normal') playSfx('sfx/enemy_death');
    else {
      playSfx('sfx/explosion');
      this.playEffect('fx/explosion', 'burst', x, y, false);
      this.cameras.main.shake(200, 0.01);
    }
    sprite.clearTint();
    sprite.disableBody(true, true);
    this.view.kills += 1;
    this.killsByType[definition.id] = (this.killsByType[definition.id] ?? 0) + 1;
    if (definition.stats.xp > 0) this.dropXp(x, y, definition.stats.xp);
    this.rollDrops(definition, x, y);
    if (definition.role === 'boss') this.winByBoss();
  }

  private rollDrops(definition: EnemyDefinition, x: number, y: number): void {
    const luck = 1 + Math.max(0, this.stat('luck'));
    let offset = 0;
    for (const drop of definition.drops) {
      if (this.rng.next() >= Math.min(1, drop.chance * luck)) continue;
      const spot = offset * 10;
      offset += 1;
      if (drop.item === 'caps') {
        const [min, max] = drop.amount;
        this.spawnPickup('cap', x + spot, y, min + Math.floor(this.rng.next() * (max - min + 1)));
      } else {
        this.spawnPickup(drop.id, x + spot, y);
      }
    }
  }

  private winByBoss(): void {
    this.bossKilled = true;
    this.finished = true;
    this.physics.pause();
    this.hero.setVelocity(0, 0);
    this.view.warning = 'ПОБЕДА!';
    this.warningUntil = Infinity;
    playSfx('sfx/reward');
    this.time.delayedCall(VICTORY_DELAY_MS, () => this.finish('survived'));
  }

  private strongestElite(): RunView['boss'] {
    let best: SpriteMob | null = null;
    for (const mob of this.mobs) {
      if (!mob.sprite.active || mob.definition.role === 'normal') continue;
      if (!best || mob.definition.role === 'boss' || mob.maxHp > best.maxHp) best = mob;
    }
    if (!best) return null;
    if (this.view.boss?.name === best.definition.name) {
      this.view.boss.fraction = best.hpFraction;
      return this.view.boss;
    }
    return { name: best.definition.name, fraction: best.hpFraction };
  }

  // --- player attacks ---------------------------------------------------------------

  private nearestEnemy(): Point | null {
    let nearest: Point | null = null;
    let best = Infinity;
    for (const mob of this.mobs) {
      if (!mob.sprite.active) continue;
      const dx = mob.sprite.x - this.hero.x;
      const dy = mob.sprite.y - this.hero.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < best) {
        nearest = mob.sprite;
        best = distanceSquared;
      }
    }
    return nearest;
  }

  private randomEnemyWithin(range: number): Point | null {
    const rangeSquared = range * range;
    let count = 0;
    for (const mob of this.mobs) {
      if (mob.sprite.active && this.distanceSquared(mob.sprite) <= rangeSquared) count += 1;
    }
    if (!count) return null;
    let pick = Math.floor(this.rng.next() * count);
    for (const mob of this.mobs) {
      if (!mob.sprite.active || this.distanceSquared(mob.sprite) > rangeSquared) continue;
      if (pick === 0) return mob.sprite;
      pick -= 1;
    }
    return null;
  }

  private distanceSquared(point: Point): number {
    const dx = point.x - this.hero.x;
    const dy = point.y - this.hero.y;
    return dx * dx + dy * dy;
  }

  private damageInRadius(center: Point, radius: number, damage: number, limit?: HitLimit): number {
    let hits = 0;
    for (const mob of this.mobs) {
      const sprite = mob.sprite;
      if (!sprite.active) continue;
      const reach = radius + sprite.width / 3;
      const dx = sprite.x - center.x;
      const dy = sprite.y - center.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      if (limit) {
        if (this.elapsedMs - (mob.hitAt[limit.owner] ?? -Infinity) < limit.cooldownMs) continue;
        mob.hitAt[limit.owner] = this.elapsedMs;
      }
      hits += 1;
      this.damageMob(mob, damage, sprite.x, sprite.y);
    }
    for (const item of this.crates.getChildren()) {
      const crate = item as Phaser.Physics.Arcade.Sprite;
      if (!crate.active) continue;
      if (Phaser.Math.Distance.Between(crate.x, crate.y, center.x, center.y) <= radius + 6) {
        this.hitCrate(crate, damage);
      }
    }
    return hits;
  }

  private updateWeapons(delta: number): void {
    const attackSpeed = 1 + this.stat('attackSpeed');
    for (const [id, state] of this.weapons) {
      const definition = this.catalog.weapons[id]!;
      const level = definition.levels[state.level - 1]!;
      const behavior = weaponBehaviors[definition.behavior.type]!;
      behavior.update?.(this.combat, definition, level, definition.behavior.params, state, delta);
      const cooldown = level.cooldownMs / attackSpeed;
      state.clock += delta;
      if (state.clock < cooldown) continue;
      const result = behavior.fire(this.combat, definition, level, definition.behavior.params, state);
      if (result === 'skip') {
        state.clock = cooldown;
        continue;
      }
      state.clock -= cooldown;
      if (result === 'fired') playSfx(definition.fireSound, 0.8);
    }
  }

  private spawnProjectile(spec: ProjectileSpec): void {
    const bullet = this.projectiles.getFirstDead(false) as Phaser.Physics.Arcade.Sprite | null;
    if (!bullet) return;
    bullet.setTexture(ATLAS, spec.sprite);
    bullet.enableBody(true, this.hero.x, this.hero.y, true, true);
    (bullet.getData('hits') as Set<number>).clear();
    bullet.setData('damage', spec.damage).setData('pierce', spec.pierce)
      .setData('expiresAt', this.elapsedMs + spec.lifetimeMs);
    bullet.setVelocity(spec.vx, spec.vy).setRotation(Math.atan2(spec.vy, spec.vx));
  }

  private consumeBullet(bullet: Phaser.Physics.Arcade.Sprite): void {
    const pierce = bullet.getData('pierce') as number;
    if (pierce > 0) bullet.setData('pierce', pierce - 1);
    else bullet.disableBody(true, true);
  }

  private spawnZone(spec: ZoneSpec): void {
    const zone = this.zones.find((candidate) => !candidate.active);
    if (!zone) return;
    Object.assign(zone, spec, {
      active: true, nextTick: this.elapsedMs, until: this.elapsedMs + spec.durationMs,
    });
    zone.flames.forEach((flame, index) => {
      const angle = (index / (FLAMES_PER_ZONE - 1)) * Math.PI * 2;
      const distance = index === 0 ? 0 : spec.radius * 0.6;
      flame.setPosition(spec.x + Math.cos(angle) * distance, spec.y + Math.sin(angle) * distance)
        .setVisible(true).play({ key: animationKey(spec.sprite, 'burn'), startFrame: index % 3 });
    });
  }

  private updateZones(): void {
    for (const zone of this.zones) {
      if (!zone.active) continue;
      if (this.elapsedMs >= zone.until) {
        zone.active = false;
        for (const flame of zone.flames) flame.stop().setVisible(false);
        continue;
      }
      if (this.elapsedMs >= zone.nextTick) {
        zone.nextTick += zone.tickMs;
        this.damageInRadius(zone, zone.radius, zone.damage);
      }
    }
  }

  private placeOrbiters(owner: string, sprite: string, positions: readonly Point[]): void {
    let pool = this.orbiters.get(owner);
    if (!pool) {
      pool = [];
      this.orbiters.set(owner, pool);
    }
    while (pool.length < positions.length) {
      pool.push(this.add.sprite(0, 0, ATLAS, sprite).setDepth(11)
        .play(animationKey(sprite, 'spin')));
    }
    pool.forEach((orbiter, index) => {
      const position = positions[index];
      if (position) orbiter.setVisible(true).setPosition(position.x, position.y);
      else orbiter.setVisible(false);
    });
  }

  private drawAreas(): void {
    const graphics = this.areaGraphics.clear();
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsedMs / 180);
    for (const radius of this.auras.values()) {
      graphics.fillStyle(0x9bff6e, 0.08 + 0.05 * pulse).fillCircle(this.hero.x, this.hero.y, radius);
      graphics.lineStyle(1, 0x9bff6e, 0.35 + 0.2 * pulse).strokeCircle(this.hero.x, this.hero.y, radius);
    }
    for (const zone of this.zones) {
      if (zone.active) graphics.fillStyle(0xd9602a, 0.18).fillCircle(zone.x, zone.y, zone.radius);
    }
  }

  // --- loot --------------------------------------------------------------------------

  private hitCrate(crate: Phaser.Physics.Arcade.Sprite, damage: number): void {
    const hp = (crate.getData('hp') as number) - damage;
    crate.setData('hp', hp);
    if (hp > 0) return;
    const { x, y } = crate;
    this.decor.breakCrate(crate);
    this.playEffect('decor/crate', 'break', x, y, false);
    playSfx('sfx/crate_break');
    const drops = this.location.decor.crates.drops;
    let roll = this.rng.next() * drops.reduce((sum, drop) => sum + drop.weight, 0);
    for (const drop of drops) {
      roll -= drop.weight;
      if (roll < 0) {
        this.spawnPickup(drop.pickup, x, y);
        return;
      }
    }
  }

  private spawnPickup(id: string, x: number, y: number, amount = 0): void {
    const definition = this.catalog.pickups[id];
    const pickup = this.pickups.getFirstDead(false) as Phaser.Physics.Arcade.Sprite | null;
    if (!definition || !pickup) return;
    pickup.setTexture(ATLAS, definition.sprite).enableBody(true, x, y, true, true);
    pickup.setVelocity(0, 0).setDepth(definition.attract ? 1 : 2);
    pickup.setData('pickupId', id).setData('amount', amount).setData('pulled', false);
    const idle = animationKey(definition.sprite, 'idle');
    if (this.anims.exists(idle)) pickup.play(idle);
  }

  private dropXp(x: number, y: number, amount: number): void {
    const crystal = this.crystals.getFirstDead(false) as Phaser.Physics.Arcade.Sprite | null;
    if (!crystal) return;
    crystal.enableBody(true, x, y, true, true);
    crystal.setData('xp', amount).setData('pulled', false);
    crystal.anims.play({ key: animationKey('xp/green', 'idle'), startFrame: this.view.kills % 4 }, true);
  }

  private isAttracting(sprite: Phaser.GameObjects.GameObject): boolean {
    if (this.crystals.contains(sprite)) return true;
    return this.catalog.pickups[sprite.getData('pickupId') as string]?.attract ?? false;
  }

  private updateLoot(): void {
    const { collectRadius, magnetSpeed } = this.catalog.balance.run;
    const attractRadius = this.stat('pickupRadius');
    for (const group of [this.crystals, this.pickups]) {
      for (const item of group.getChildren()) {
        const sprite = item as Phaser.Physics.Arcade.Sprite;
        if (!sprite.active) continue;
        const dx = this.hero.x - sprite.x;
        const dy = this.hero.y - sprite.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= collectRadius + 4) {
          if (this.collect(sprite)) return;
          continue;
        }
        const attracts = this.isAttracting(sprite);
        if (attracts && (sprite.getData('pulled') || distance < attractRadius)) {
          sprite.setData('pulled', true);
          const speed = magnetSpeed + distance;
          sprite.setVelocity((dx / distance) * speed, (dy / distance) * speed);
        }
      }
    }
  }

  /** Returns true when collecting paused the run (level-up or chest). */
  private collect(sprite: Phaser.Physics.Arcade.Sprite): boolean {
    sprite.disableBody(true, true);
    if (this.crystals.contains(sprite)) {
      playSfx('sfx/xp_pickup', 0.7);
      return this.gainXp((sprite.getData('xp') as number) * (1 + this.stat('xpGain')));
    }
    const definition = this.catalog.pickups[sprite.getData('pickupId') as string]!;
    playSfx(definition.sound);
    const amount = sprite.getData('amount') as number;
    if (amount > 0) {
      this.view.caps += amount;
      this.label(`+${amount}`, COLORS.warn);
      return false;
    }
    if (definition.effect.type !== 'chest') {
      const caps = this.view.caps;
      pickupEffects[definition.effect.type]!.apply(this.pickupContext, definition.effect.params);
      const gained = this.view.caps - caps;
      this.label(gained > 0 ? `+${gained}` : `+${definition.name.toUpperCase()}`,
        gained > 0 ? COLORS.warn : COLORS.bright);
      return false;
    }
    pickupEffects[definition.effect.type]!.apply(this.pickupContext, definition.effect.params);
    return !this.scene.isActive();
  }

  // --- progression -------------------------------------------------------------------

  private newWeaponState(): WeaponState {
    return { level: 1, clock: 0, activeUntil: 0, angle: 0 };
  }

  private upgradePool(ownedOnly: boolean): UpgradeChoice[] {
    const pool: UpgradeChoice[] = [];
    for (const weapon of Object.values(this.catalog.weapons)) {
      const owned = this.weapons.get(weapon.id);
      if (ownedOnly && !owned) continue;
      if (weapon.evolved && !owned) continue;
      if (!owned || owned.level < weapon.levels.length) {
        pool.push({ kind: 'weapon', id: weapon.id, name: weapon.name, sprite: weapon.sprite,
          description: owned ? `Уровень ${owned.level + 1}` : 'Новое оружие' });
      }
    }
    for (const passive of Object.values(this.catalog.passives)) {
      const level = this.ownedPassives.get(passive.id) ?? 0;
      if (ownedOnly && !level) continue;
      if (level < passive.maxLevel) {
        pool.push({ kind: 'passive', id: passive.id, name: passive.name, sprite: passive.sprite,
          description: `${passive.description} · Ур. ${level + 1}` });
      }
    }
    return pool;
  }

  private evolutionChoices(): UpgradeChoice[] {
    const { weapons, passives } = this.catalog;
    return availableEvolutions(weapons, this.weapons, this.ownedPassives).map((option) => {
      const target = weapons[option.into]!;
      return { kind: 'evolution', id: target.id, name: target.name, sprite: target.sprite,
        description: `${weapons[option.from]!.name} + ${passives[option.passive]!.name}` };
    });
  }

  /** Three cards; a ready evolution always takes the first one. */
  private rollChoices(): UpgradeChoice[] {
    const pool = this.upgradePool(false);
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const chosen = Math.floor(this.rng.next() * (index + 1));
      [pool[index], pool[chosen]] = [pool[chosen]!, pool[index]!];
    }
    return [...this.evolutionChoices().slice(0, 1), ...pool].slice(0, 3);
  }

  private gainXp(amount: number): boolean {
    this.view.xp += amount;
    if (this.view.xp < this.view.nextXp) return false;
    this.view.xp -= this.view.nextXp;
    this.view.level += 1;
    this.view.nextXp = Math.ceil(
      this.catalog.balance.xp.base * this.catalog.balance.xp.growth ** (this.view.level - 1),
    );
    this.choices = this.rollChoices();
    if (!this.choices.length) return false;
    playSfx('sfx/level_up');
    this.hero.setVelocity(0, 0);
    this.scene.launch('LevelUp');
    this.scene.bringToTop('LevelUp');
    this.scene.pause();
    return true;
  }

  applyUpgrade(choice: UpgradeChoice): void {
    if (!this.choices.some((item) => item.id === choice.id && item.kind === choice.kind)) return;
    this.grant(choice);
    this.choices = [];
  }

  private grant(choice: UpgradeChoice): void {
    if (choice.kind === 'evolution') {
      const source = evolutionSource(this.catalog.weapons, choice.id);
      const state = source && this.weapons.get(source.id);
      if (!source || !state) return;
      this.weapons.delete(source.id);
      this.weapons.set(choice.id, { ...state, level: 1 });
      this.placeOrbiters(source.id, source.projectileSprite, []);
      playSfx('sfx/powerup');
    } else if (choice.kind === 'weapon') {
      const owned = this.weapons.get(choice.id);
      if (owned) owned.level += 1;
      else this.weapons.set(choice.id, this.newWeaponState());
    } else {
      this.ownedPassives.set(choice.id, (this.ownedPassives.get(choice.id) ?? 0) + 1);
    }
    const maxHp = this.stat('maxHp');
    this.view.hp += Math.max(0, maxHp - this.view.maxHp);
    this.view.maxHp = maxHp;
  }

  /** Chest: a ready evolution first, then owned items (new ones only if nothing owned can grow). */
  private openChest(items: number, caps: number): void {
    const granted: UpgradeChoice[] = [];
    for (let index = 0; index < items; index += 1) {
      // Prefer owned items, and different ones, before repeating or adding new items.
      const fresh = (list: UpgradeChoice[]) => list.filter((item) =>
        !granted.some((done) => done.id === item.id && done.kind === item.kind));
      const owned = this.upgradePool(true);
      const candidates = [
        this.evolutionChoices(), fresh(owned), owned, fresh(this.upgradePool(false)),
      ];
      const pool = candidates.find((list) => list.length) ?? [];
      if (!pool.length) break;
      const choice = pool[Math.floor(this.rng.next() * pool.length)]!;
      this.grant(choice);
      granted.push(choice);
    }
    this.view.caps += caps;
    this.chest = { granted, caps };
    this.hero.setVelocity(0, 0);
    this.scene.launch('Chest');
    this.scene.bringToTop('Chest');
    this.scene.pause();
  }

  // --- damage, death, end ------------------------------------------------------------

  private takeDamage(damage: number, ignoreCooldown = false): void {
    if (this.finished) return;
    if (!ignoreCooldown &&
      this.elapsedMs - this.lastDamageAt < this.catalog.balance.run.contactCooldownMs) return;
    this.lastDamageAt = this.elapsedMs;
    playSfx('sfx/hero_hurt');
    this.view.hp = Math.max(0, this.view.hp - Math.max(1, damage - this.stat('armor')));
    this.cameras.main.shake(80, 0.005);
    this.hero.setTint(0xff7777);
    this.time.delayedCall(100, () => this.hero.clearTint());
    if (this.view.hp <= 0) this.die();
  }

  private die(): void {
    if (this.finished) return;
    this.finished = true;
    this.physics.pause();
    this.hero.setVelocity(0, 0);
    playSfx('sfx/hero_death');
    const death = animationKey(this.heroDefinition.sprite, 'death');
    if (this.anims.exists(death)) this.hero.anims.play(death);
    this.time.delayedCall(HERO_DEATH_DELAY_MS, () => this.finish('death'));
  }

  private finish(reason: 'death' | 'survived'): void {
    this.finished = true;
    this.hero.setVelocity(0, 0);
    this.scene.stop('Hud');
    const result: ResultData = {
      reason, seconds: this.view.seconds, kills: this.view.kills,
      level: this.view.level, seed: this.view.seed, runId: this.runId,
      bossKilled: this.bossKilled,
      summary: {
        content_hash: this.contentHash,
        duration_seconds: this.view.seconds,
        kills_by_type: { ...this.killsByType },
        wave_reached: this.view.wave,
        boss_killed: this.bossKilled,
        picked_caps: this.view.caps,
      },
    };
    this.scene.start('Result', result);
  }

  // --- helpers -----------------------------------------------------------------------

  private label(text: string, color: string): void {
    const label = this.labels.find((item) => !item.visible);
    if (!label) return;
    label.setText(text).setColor(color).setPosition(this.hero.x, this.hero.y - 14)
      .setAlpha(1).setVisible(true);
    this.tweens.add({
      targets: label, y: label.y - 18, alpha: 0, duration: 900,
      onComplete: () => label.setVisible(false),
    });
  }

  private playEffect(sprite: string, animation: string, x: number, y: number, flipX: boolean): void {
    const key = animationKey(sprite, animation);
    if (!this.anims.exists(key)) return;
    const effect = this.effects.getFirstDead(false) as Phaser.GameObjects.Sprite | null;
    if (!effect) return;
    effect.setActive(true).setVisible(true).setPosition(x, y).setFlipX(flipX).play(key);
  }

  private createPool(key: string, size: number): Phaser.Physics.Arcade.Group {
    const pool = this.physics.add.group({ maxSize: size, runChildUpdate: false });
    for (let index = 0; index < size; index += 1) {
      const item = pool.create(0, 0, ATLAS, key) as Phaser.Physics.Arcade.Sprite;
      item.setData('damage', 0).setData('expiresAt', 0).setData('xp', 0);
      item.disableBody(true, true);
    }
    return pool;
  }

  private expire(group: Phaser.Physics.Arcade.Group): void {
    for (const item of group.getChildren()) {
      const sprite = item as Phaser.Physics.Arcade.Sprite;
      if (sprite.active && this.elapsedMs >= (sprite.getData('expiresAt') as number)) {
        sprite.disableBody(true, true);
      }
    }
  }
}

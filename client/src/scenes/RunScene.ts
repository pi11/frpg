import * as Phaser from 'phaser';
import { animationKey, ATLAS } from '../assets';
import { enemyBehaviors, weaponBehaviors } from '../behaviors/registry';
import type { FireContext } from '../behaviors/weapons/Projectile';
import { getCatalog } from '../content/catalog';
import type { Catalog } from '../content/catalog';
import type {
  EnemyDefinition, HeroDefinition, LocationDefinition, StatKey,
} from '../content/schemas';
import { inputState } from '../inputState';
import { playMusic, playSfx } from '../sound';
import { Rng } from '../systems/rng';
import type { ResultData } from './ResultScene';

export interface RunView {
  hp: number;
  maxHp: number;
  xp: number;
  nextXp: number;
  level: number;
  kills: number;
  seconds: number;
  wave: number;
  enemyCount: number;
  projectileCount: number;
  seed: number;
}

export interface UpgradeChoice {
  kind: 'weapon' | 'passive';
  id: string;
  name: string;
  description: string;
  sprite: string;
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

/** Presentation constants (not balance): effect pool size and death animation pause. */
const EFFECT_POOL_SIZE = 96;
const HERO_DEATH_DELAY_MS = 900;

interface OwnedWeapon {
  level: number;
  clock: number;
}

export class RunScene extends Phaser.Scene {
  readonly view: RunView = {
    hp: 0, maxHp: 0, xp: 0, nextXp: 0, level: 1, kills: 0, seconds: 0,
    wave: 1, enemyCount: 0, projectileCount: 0, seed: 0,
  };
  choices: UpgradeChoice[] = [];

  private catalog!: Catalog;
  private heroDefinition!: HeroDefinition;
  private location!: LocationDefinition;
  private hero!: Phaser.Physics.Arcade.Sprite;
  private enemies!: Phaser.Physics.Arcade.Group;
  private projectiles!: Phaser.Physics.Arcade.Group;
  private crystals!: Phaser.Physics.Arcade.Group;
  private ground!: Phaser.GameObjects.TileSprite;
  /** Death puffs and hit sparks: a fixed pool of plain sprites, never physics bodies. */
  private effects!: Phaser.GameObjects.Group;
  private pendingFireSound: string | null = null;
  private spawnCount = 0;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private rng!: Rng;
  private fireContext!: FireContext;
  private ownedWeapons = new Map<string, OwnedWeapon>();
  private ownedPassives = new Map<string, number>();
  private shelterUpgrades: Record<string, number> = {};
  private killsByType: Record<string, number> = {};
  private runId = '';
  private contentHash = '';
  private waveIndex = 0;
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
    this.ownedWeapons = new Map([[hero.startingWeapon, { level: 1, clock: 0 }]]);
    this.ownedPassives = new Map();
    this.shelterUpgrades = { ...data.upgrades };
    this.killsByType = {};
    this.runId = data.runId;
    this.contentHash = data.contentHash;
    this.waveIndex = Math.min(data.wave, location.waves.length - 1);
    this.elapsedMs = location.waves[this.waveIndex]!.atSecond * 1000;
    this.spawnClock = 0;
    this.lastDamageAt = -Infinity;
    this.finished = false;
    this.choices = [];
    Object.assign(this.view, {
      hp: this.stat('maxHp'), maxHp: this.stat('maxHp'), xp: 0,
      nextXp: this.catalog.balance.xp.base, level: 1, kills: 0,
      seconds: Math.floor(this.elapsedMs / 1000), wave: this.waveIndex + 1,
      enemyCount: 0, projectileCount: 0, seed: data.seed,
    });
    inputState.x = 0;
    inputState.y = 0;
  }

  create(): void {
    this.physics.world.setBounds(-100000, -100000, 200000, 200000);
    this.ground = this.add.tileSprite(0, 0, 480, 270, this.location.groundSprite)
      .setOrigin(0).setScrollFactor(0).setDepth(-100);
    this.hero = this.physics.add.sprite(0, 0, ATLAS, this.heroDefinition.sprite).setDepth(10);
    (this.hero.body as Phaser.Physics.Arcade.Body).setSize(12, 12);
    this.cameras.main.startFollow(this.hero, true);
    this.cameras.main.setRoundPixels(true);

    const firstEnemy = Object.values(this.catalog.enemies)[0]!;
    const firstWeapon = Object.values(this.catalog.weapons)[0]!;
    this.enemies = this.createPool(firstEnemy.sprite, this.catalog.balance.run.enemyLimit);
    this.projectiles = this.createPool(
      firstWeapon.projectileSprite, this.catalog.balance.run.projectileLimit,
    );
    this.crystals = this.createPool('xp/green', this.catalog.balance.run.xpLimit);
    this.effects = this.add.group({ maxSize: EFFECT_POOL_SIZE });
    for (let index = 0; index < EFFECT_POOL_SIZE; index += 1) {
      const effect = this.add.sprite(0, 0, ATLAS, 'fx/hit').setDepth(5);
      effect.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        effect.setActive(false).setVisible(false);
      });
      this.effects.add(effect.setActive(false).setVisible(false));
    }
    this.fireContext = {
      x: 0, y: 0,
      nearestTarget: () => this.nearestTarget(),
      spawnProjectile: (vx, vy, damage, lifetimeMs, sprite) => {
        this.spawnProjectile(vx, vy, damage, lifetimeMs, sprite);
      },
    };

    this.physics.add.overlap(this.projectiles, this.enemies, (first, second) => {
      const bullet = first as Phaser.Physics.Arcade.Sprite;
      const enemy = second as Phaser.Physics.Arcade.Sprite;
      if (!bullet.active || !enemy.active) return;
      bullet.disableBody(true, true);
      const definition = this.catalog.enemies[enemy.getData('enemyId') as string]!;
      const hp = (enemy.getData('hp') as number) - (bullet.getData('damage') as number);
      if (hp <= 0) {
        const { x, y } = enemy;
        this.playEffect(definition.sprite, 'death', x, y, enemy.flipX);
        playSfx('sfx/enemy_death');
        enemy.disableBody(true, true);
        this.view.kills += 1;
        this.killsByType[definition.id] = (this.killsByType[definition.id] ?? 0) + 1;
        this.dropXp(x, y, definition.stats.xp);
      } else {
        enemy.setData('hp', hp);
        this.playEffect('fx/hit', 'burst', bullet.x, bullet.y, false);
        playSfx('sfx/enemy_hit', 0.6);
      }
    });
    this.physics.add.overlap(this.hero, this.enemies, (_hero, item) => {
      const enemy = item as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) return;
      const definition = this.catalog.enemies[enemy.getData('enemyId') as string]!;
      this.takeDamage(definition.stats.damage);
    });

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.keys;
    this.scene.launch('Hud');
    this.scene.bringToTop('Hud');
    playSfx('sfx/run_start');
    playMusic(this.location.music);
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
      item.setData('hp', 0);
      item.setData('damage', 0);
      item.setData('expiresAt', 0);
      item.setData('enemyId', '');
      item.setData('xp', 0);
      item.disableBody(true, true);
    }
    return pool;
  }

  update(_time: number, delta: number): void {
    if (this.finished) return;
    this.elapsedMs += delta;
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

    this.moveHero();
    this.ground.tilePositionX = this.cameras.main.scrollX;
    this.ground.tilePositionY = this.cameras.main.scrollY;

    const interval = this.location.waves[this.waveIndex]!.spawnIntervalMs;
    this.spawnClock += delta;
    while (this.spawnClock >= interval) {
      this.spawnClock -= interval;
      this.spawnEnemy();
    }
    this.moveEnemies(delta);
    this.updateProjectiles();
    this.updateCrystals();
    this.updateWeapons(delta);
    this.view.enemyCount = this.enemies.countActive();
    this.view.projectileCount = this.projectiles.countActive();
  }

  private stat(key: StatKey): number {
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

  private selectEnemy(): EnemyDefinition {
    const entries = this.location.waves[this.waveIndex]!.enemies;
    let total = 0;
    for (const entry of entries) total += entry.weight;
    let roll = this.rng.next() * total;
    for (const entry of entries) {
      roll -= entry.weight;
      if (roll < 0) return this.catalog.enemies[entry.id]!;
    }
    return this.catalog.enemies[entries.at(-1)!.id]!;
  }

  private spawnEnemy(): void {
    const enemy = this.enemies.getFirstDead(false) as Phaser.Physics.Arcade.Sprite | null;
    if (!enemy) return;
    const definition = this.selectEnemy();
    const angle = this.rng.next() * Math.PI * 2;
    const distance = this.catalog.balance.run.spawnDistance;
    enemy.setTexture(ATLAS, definition.sprite);
    enemy.enableBody(true, this.hero.x + Math.cos(angle) * distance,
      this.hero.y + Math.sin(angle) * distance, true, true);
    (enemy.body as Phaser.Physics.Arcade.Body).setSize(enemy.width, enemy.height);
    enemy.setVelocity(0, 0);
    enemy.setData('enemyId', definition.id);
    enemy.setData('hp', definition.stats.hp);
    const walk = animationKey(definition.sprite, 'walk');
    if (this.anims.exists(walk)) {
      // Visual-only phase offset: a counter, so the seeded gameplay RNG stream is untouched.
      this.spawnCount += 1;
      enemy.anims.play({ key: walk, startFrame: this.spawnCount % 4 });
    }
  }

  private moveEnemies(delta: number): void {
    const maxDistanceSquared = this.catalog.balance.run.despawnDistance ** 2;
    for (const item of this.enemies.getChildren()) {
      const enemy = item as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) continue;
      const dx = this.hero.x - enemy.x;
      const dy = this.hero.y - enemy.y;
      enemy.setFlipX(dx < 0);
      if (dx * dx + dy * dy > maxDistanceSquared) {
        enemy.disableBody(true, true);
        continue;
      }
      const definition = this.catalog.enemies[enemy.getData('enemyId') as string]!;
      const behavior = enemyBehaviors[definition.ai.type as keyof typeof enemyBehaviors];
      behavior.update(enemy, this.hero, definition, delta);
    }
  }

  private nearestTarget(): Phaser.Physics.Arcade.Sprite | null {
    let nearest: Phaser.Physics.Arcade.Sprite | null = null;
    let best = Infinity;
    for (const item of this.enemies.getChildren()) {
      const enemy = item as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) continue;
      const dx = enemy.x - this.hero.x;
      const dy = enemy.y - this.hero.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < best) {
        nearest = enemy;
        best = distanceSquared;
      }
    }
    return nearest;
  }

  private updateWeapons(delta: number): void {
    this.fireContext.x = this.hero.x;
    this.fireContext.y = this.hero.y;
    for (const [id, owned] of this.ownedWeapons) {
      const definition = this.catalog.weapons[id]!;
      const level = definition.levels[owned.level - 1]!;
      const cooldown = level.cooldownMs / (1 + this.stat('attackSpeed'));
      owned.clock += delta;
      if (owned.clock < cooldown) continue;
      owned.clock -= cooldown;
      const behavior = weaponBehaviors[definition.behavior.type as keyof typeof weaponBehaviors];
      this.pendingFireSound = definition.fireSound;
      behavior.fire(this.fireContext, definition, level, this.stat('damage'));
      this.pendingFireSound = null;
    }
  }

  private spawnProjectile(vx: number, vy: number, damage: number, lifetimeMs: number,
    sprite: string): void {
    const bullet = this.projectiles.getFirstDead(false) as Phaser.Physics.Arcade.Sprite | null;
    if (!bullet) return;
    bullet.setTexture(ATLAS, sprite);
    if (this.pendingFireSound) {
      playSfx(this.pendingFireSound);
      this.pendingFireSound = null;
    }
    bullet.enableBody(true, this.hero.x, this.hero.y, true, true);
    bullet.setData('damage', damage);
    bullet.setData('expiresAt', this.elapsedMs + lifetimeMs);
    bullet.setVelocity(vx, vy);
  }

  private updateProjectiles(): void {
    for (const item of this.projectiles.getChildren()) {
      const bullet = item as Phaser.Physics.Arcade.Sprite;
      if (bullet.active && this.elapsedMs >= (bullet.getData('expiresAt') as number)) {
        bullet.disableBody(true, true);
      }
    }
  }

  private dropXp(x: number, y: number, amount: number): void {
    const crystal = this.crystals.getFirstDead(false) as Phaser.Physics.Arcade.Sprite | null;
    if (!crystal) return;
    crystal.enableBody(true, x, y, true, true);
    crystal.setData('xp', amount);
    crystal.anims.play({ key: animationKey('xp/green', 'idle'), startFrame: this.view.kills % 4 }, true);
  }

  private updateCrystals(): void {
    for (const item of this.crystals.getChildren()) {
      const crystal = item as Phaser.Physics.Arcade.Sprite;
      if (!crystal.active) continue;
      const dx = this.hero.x - crystal.x;
      const dy = this.hero.y - crystal.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= this.stat('pickupRadius')) {
        const amount = crystal.getData('xp') as number;
        crystal.disableBody(true, true);
        playSfx('sfx/xp_pickup', 0.7);
        if (this.gainXp(amount * (1 + this.stat('xpGain')))) break;
        continue;
      }
      if (distance < this.catalog.balance.run.magnetRadius && distance > 0) {
        const speed = this.catalog.balance.run.magnetSpeed;
        crystal.setVelocity((dx / distance) * speed, (dy / distance) * speed);
      } else {
        crystal.setVelocity(0, 0);
      }
    }
  }

  private rollChoices(): UpgradeChoice[] {
    const pool: UpgradeChoice[] = [];
    for (const weapon of Object.values(this.catalog.weapons)) {
      const owned = this.ownedWeapons.get(weapon.id);
      if (!owned || owned.level < weapon.levels.length) {
        pool.push({ kind: 'weapon', id: weapon.id, name: weapon.name, sprite: weapon.sprite,
          description: owned ? `Уровень ${owned.level + 1}` : 'Новое оружие' });
      }
    }
    for (const passive of Object.values(this.catalog.passives)) {
      const level = this.ownedPassives.get(passive.id) ?? 0;
      if (level < passive.maxLevel) {
        pool.push({ kind: 'passive', id: passive.id, name: passive.name, sprite: passive.sprite,
          description: `${passive.description} · Ур. ${level + 1}` });
      }
    }
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const chosen = Math.floor(this.rng.next() * (index + 1));
      [pool[index], pool[chosen]] = [pool[chosen]!, pool[index]!];
    }
    return pool.slice(0, 3);
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
    if (choice.kind === 'weapon') {
      const owned = this.ownedWeapons.get(choice.id);
      if (owned) owned.level += 1;
      else this.ownedWeapons.set(choice.id, { level: 1, clock: 0 });
    } else {
      this.ownedPassives.set(choice.id, (this.ownedPassives.get(choice.id) ?? 0) + 1);
    }
    this.view.maxHp = this.stat('maxHp');
    this.choices = [];
  }

  private takeDamage(damage: number): void {
    if (this.elapsedMs - this.lastDamageAt < this.catalog.balance.run.contactCooldownMs) return;
    this.lastDamageAt = this.elapsedMs;
    playSfx('sfx/hero_hurt');
    this.view.hp = Math.max(0, this.view.hp - Math.max(0, damage - this.stat('armor')));
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
      summary: {
        content_hash: this.contentHash,
        duration_seconds: this.view.seconds,
        kills_by_type: { ...this.killsByType },
        wave_reached: this.view.wave,
        boss_killed: false,
        picked_caps: 0,
      },
    };
    this.scene.start('Result', result);
  }
}

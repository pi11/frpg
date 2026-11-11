import * as Phaser from 'phaser';
import balance from '../../../content/balance.json';
import { inputState } from '../inputState';
import { Rng } from '../systems/rng';

export interface RunView {
  hp: number;
  maxHp: number;
  xp: number;
  nextXp: number;
  level: number;
  kills: number;
  seconds: number;
  enemyCount: number;
  projectileCount: number;
  seed: number;
}

interface RunData {
  seed: number;
}

export class RunScene extends Phaser.Scene {
  readonly view: RunView = {
    hp: balance.hero.maxHp,
    maxHp: balance.hero.maxHp,
    xp: 0,
    nextXp: balance.xp.base,
    level: 1,
    kills: 0,
    seconds: 0,
    enemyCount: 0,
    projectileCount: 0,
    seed: 0,
  };

  private hero!: Phaser.Physics.Arcade.Sprite;
  private enemies!: Phaser.Physics.Arcade.Group;
  private projectiles!: Phaser.Physics.Arcade.Group;
  private crystals!: Phaser.Physics.Arcade.Group;
  private ground!: Phaser.GameObjects.TileSprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private rng!: Rng;
  private elapsedMs = 0;
  private spawnClock = 0;
  private shotClock = 0;
  private lastDamageAt = -Infinity;
  private damage = balance.weapon.damage;
  private moveSpeed = balance.hero.moveSpeed;
  private cooldownMs = balance.weapon.cooldownMs;
  private finished = false;

  constructor() {
    super('Run');
  }

  init(data: RunData): void {
    this.rng = new Rng(data.seed);
    Object.assign(this.view, {
      hp: balance.hero.maxHp,
      maxHp: balance.hero.maxHp,
      xp: 0,
      nextXp: balance.xp.base,
      level: 1,
      kills: 0,
      seconds: 0,
      enemyCount: 0,
      projectileCount: 0,
      seed: data.seed,
    });
    this.elapsedMs = 0;
    this.spawnClock = 0;
    this.shotClock = 0;
    this.lastDamageAt = -Infinity;
    this.damage = balance.weapon.damage;
    this.moveSpeed = balance.hero.moveSpeed;
    this.cooldownMs = balance.weapon.cooldownMs;
    this.finished = false;
    inputState.x = 0;
    inputState.y = 0;
  }

  create(): void {
    this.physics.world.setBounds(-100000, -100000, 200000, 200000);
    this.ground = this.add.tileSprite(0, 0, 480, 270, 'ground')
      .setOrigin(0).setScrollFactor(0).setDepth(-100);
    this.hero = this.physics.add.sprite(0, 0, 'hero').setDepth(10);
    this.hero.setCollideWorldBounds(false);
    (this.hero.body as Phaser.Physics.Arcade.Body).setSize(12, 12);
    this.cameras.main.startFollow(this.hero, true);
    this.cameras.main.setRoundPixels(true);

    this.enemies = this.createPool('enemy', balance.run.enemyLimit);
    this.projectiles = this.createPool('projectile', balance.run.projectileLimit);
    this.crystals = this.createPool('xp', balance.run.xpLimit);

    this.physics.add.overlap(this.projectiles, this.enemies, (first, second) => {
      const bullet = first as Phaser.Physics.Arcade.Sprite;
      const enemy = second as Phaser.Physics.Arcade.Sprite;
      if (!bullet.active || !enemy.active) return;
      bullet.disableBody(true, true);
      const hp = (enemy.getData('hp') as number) - (bullet.getData('damage') as number);
      if (hp <= 0) {
        const { x, y } = enemy;
        enemy.disableBody(true, true);
        this.view.kills += 1;
        this.dropXp(x, y);
      } else {
        enemy.setData('hp', hp);
      }
    });
    this.physics.add.overlap(this.hero, this.enemies, () => this.takeDamage());

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.keys;
    this.scene.launch('Hud');
    this.scene.bringToTop('Hud');
  }

  private createPool(key: string, size: number): Phaser.Physics.Arcade.Group {
    const pool = this.physics.add.group({ maxSize: size, runChildUpdate: false });
    for (let index = 0; index < size; index += 1) {
      const item = pool.create(0, 0, key) as Phaser.Physics.Arcade.Sprite;
      item.setData('hp', balance.enemy.hp);
      item.setData('damage', balance.weapon.damage);
      item.setData('expiresAt', 0);
      item.disableBody(true, true);
    }
    return pool;
  }

  update(_time: number, delta: number): void {
    if (this.finished) return;
    this.elapsedMs += delta;
    this.view.seconds = Math.floor(this.elapsedMs / 1000);
    if (this.view.seconds >= balance.run.durationSeconds) {
      this.finish('survived');
      return;
    }

    this.moveHero();
    this.ground.tilePositionX = this.cameras.main.scrollX;
    this.ground.tilePositionY = this.cameras.main.scrollY;

    this.spawnClock += delta;
    while (this.spawnClock >= balance.run.spawnIntervalMs) {
      this.spawnClock -= balance.run.spawnIntervalMs;
      this.spawnEnemy();
    }
    this.moveEnemies();
    this.updateProjectiles();
    this.updateCrystals();
    this.shotClock += delta;
    if (this.shotClock >= this.cooldownMs) {
      this.shotClock -= this.cooldownMs;
      this.fireAtNearest();
    }
    this.view.enemyCount = this.enemies.countActive();
    this.view.projectileCount = this.projectiles.countActive();
  }

  private moveHero(): void {
    let x = inputState.x;
    let y = inputState.y;
    if (this.keys.A.isDown || this.cursors.left.isDown) x -= 1;
    if (this.keys.D.isDown || this.cursors.right.isDown) x += 1;
    if (this.keys.W.isDown || this.cursors.up.isDown) y -= 1;
    if (this.keys.S.isDown || this.cursors.down.isDown) y += 1;
    const length = Math.hypot(x, y);
    this.hero.setVelocity(
      length > 0 ? (x / length) * this.moveSpeed : 0,
      length > 0 ? (y / length) * this.moveSpeed : 0,
    );
  }

  private spawnEnemy(): void {
    const enemy = this.enemies.getFirstDead(false) as Phaser.Physics.Arcade.Sprite | null;
    if (!enemy) return;
    const angle = this.rng.next() * Math.PI * 2;
    const distance = balance.run.spawnDistance;
    enemy.enableBody(
      true,
      this.hero.x + Math.cos(angle) * distance,
      this.hero.y + Math.sin(angle) * distance,
      true,
      true,
    );
    enemy.setData('hp', balance.enemy.hp);
  }

  private moveEnemies(): void {
    const maxDistanceSquared = balance.run.despawnDistance ** 2;
    for (const item of this.enemies.getChildren()) {
      const enemy = item as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) continue;
      const dx = this.hero.x - enemy.x;
      const dy = this.hero.y - enemy.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > maxDistanceSquared) {
        enemy.disableBody(true, true);
        continue;
      }
      const distance = Math.sqrt(distanceSquared);
      enemy.setVelocity(
        distance > 0 ? (dx / distance) * balance.enemy.moveSpeed : 0,
        distance > 0 ? (dy / distance) * balance.enemy.moveSpeed : 0,
      );
    }
  }

  private fireAtNearest(): void {
    let nearest: Phaser.Physics.Arcade.Sprite | null = null;
    let bestDistanceSquared = Infinity;
    for (const item of this.enemies.getChildren()) {
      const enemy = item as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) continue;
      const dx = enemy.x - this.hero.x;
      const dy = enemy.y - this.hero.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < bestDistanceSquared) {
        nearest = enemy;
        bestDistanceSquared = distanceSquared;
      }
    }
    if (!nearest) return;
    const bullet = this.projectiles.getFirstDead(false) as Phaser.Physics.Arcade.Sprite | null;
    if (!bullet) return;
    const distance = Math.sqrt(bestDistanceSquared);
    bullet.enableBody(true, this.hero.x, this.hero.y, true, true);
    bullet.setData('damage', this.damage);
    bullet.setData('expiresAt', this.elapsedMs + balance.weapon.projectileLifetimeMs);
    bullet.setVelocity(
      distance > 0 ? ((nearest.x - this.hero.x) / distance) * balance.weapon.projectileSpeed : 0,
      distance > 0 ? ((nearest.y - this.hero.y) / distance) * balance.weapon.projectileSpeed : 0,
    );
  }

  private updateProjectiles(): void {
    for (const item of this.projectiles.getChildren()) {
      const bullet = item as Phaser.Physics.Arcade.Sprite;
      if (bullet.active && this.elapsedMs >= (bullet.getData('expiresAt') as number)) {
        bullet.disableBody(true, true);
      }
    }
  }

  private dropXp(x: number, y: number): void {
    const crystal = this.crystals.getFirstDead(false) as Phaser.Physics.Arcade.Sprite | null;
    if (crystal) crystal.enableBody(true, x, y, true, true);
  }

  private updateCrystals(): void {
    const radius = balance.hero.magnetRadius;
    for (const item of this.crystals.getChildren()) {
      const crystal = item as Phaser.Physics.Arcade.Sprite;
      if (!crystal.active) continue;
      const dx = this.hero.x - crystal.x;
      const dy = this.hero.y - crystal.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= balance.hero.pickupRadius) {
        crystal.disableBody(true, true);
        if (this.gainXp(balance.enemy.xp)) break;
        continue;
      }
      if (distance < radius && distance > 0) {
        crystal.setVelocity((dx / distance) * balance.hero.magnetSpeed,
          (dy / distance) * balance.hero.magnetSpeed);
      } else {
        crystal.setVelocity(0, 0);
      }
    }
  }

  private gainXp(amount: number): boolean {
    this.view.xp += amount;
    if (this.view.xp < this.view.nextXp) return false;
    this.view.xp -= this.view.nextXp;
    this.view.level += 1;
    this.view.nextXp = Math.ceil(balance.xp.base * balance.xp.growth ** (this.view.level - 1));
    this.hero.setVelocity(0, 0);
    this.scene.launch('LevelUp');
    this.scene.bringToTop('LevelUp');
    this.scene.pause();
    return true;
  }

  applyUpgrade(id: string): void {
    const choice = balance.upgrades.find((upgrade) => upgrade.id === id);
    if (!choice) return;
    switch (id) {
      case 'damage':
        this.damage += choice.amount;
        break;
      case 'speed':
        this.moveSpeed += choice.amount;
        break;
      case 'fire_rate':
        if ('minCooldownMs' in choice && typeof choice.minCooldownMs === 'number') {
          this.cooldownMs = Math.max(choice.minCooldownMs, this.cooldownMs - choice.amount);
        }
        break;
    }
  }

  private takeDamage(): void {
    if (this.elapsedMs - this.lastDamageAt < balance.run.contactCooldownMs) return;
    this.lastDamageAt = this.elapsedMs;
    this.view.hp = Math.max(0, this.view.hp - balance.enemy.damage);
    this.cameras.main.shake(80, 0.005);
    this.hero.setTint(0xff7777);
    this.time.delayedCall(100, () => this.hero.clearTint());
    if (this.view.hp <= 0) this.finish('death');
  }

  private finish(reason: 'death' | 'survived'): void {
    this.finished = true;
    this.hero.setVelocity(0, 0);
    this.scene.stop('Hud');
    this.scene.start('Result', {
      reason,
      seconds: this.view.seconds,
      kills: this.view.kills,
      level: this.view.level,
      seed: this.view.seed,
    });
  }
}

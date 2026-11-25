import * as Phaser from 'phaser';
import { animationKey, ATLAS } from '../assets';
import { enemyBehaviors, pickupEffects, weaponBehaviors } from '../behaviors/registry';
import type {
  BlastSpec, CombatContext, EnemyContext, HitLimit, Mob, PickupContext, Point, ProjectileSpec, WeaponState,
  ZoneSpec,
} from '../behaviors/types';
import { getCatalog } from '../content/catalog';
import type { Catalog } from '../content/catalog';
import type {
  EnemyDefinition, HeroDefinition, LocationDefinition, PassiveDefinition, StatKey, WeaponDefinition,
} from '../content/schemas';
import { inputState, shelterState } from '../inputState';
import { playMusic, playSfx, playTune } from '../sound';
import { isReached, newRecord, type RunRecord } from '../systems/achievements';
import { autopilotDirection, type Threat } from '../systems/autopilot';
import { keepAwake } from '../platform/wakeLock';
import { settings } from '../settings';
import { refillBudget, softCap } from '../systems/limits';
import { Rng } from '../systems/rng';
import { availableEvolutions, evolutionSource } from '../systems/evolutions';
import { COLORS, textStyle } from '../ui/theme';
import { onLayoutChange } from '../ui/layout';
import { levelChanges, levelStats, statBonus } from '../content/statText';
import { WorldDecor, type ActiveLandmark } from '../systems/WorldDecor';
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
  rerolls: number;
  revives: number;
  /** Timed bonuses for the HUD, remaining share 0..1. */
  buffs: { sprite: string; name: string; text: string; fraction: number }[];
  /** Emeralds earned so far in this run (the server counts them again). */
  emeralds: number;
  /** Achievement banner. */
  toast: string;
}

export interface UpgradeChoice {
  kind: 'weapon' | 'passive' | 'evolution';
  id: string;
  name: string;
  description: string;
  sprite: string;
  /** Icons of the other halves of evolutions this card leads to. */
  pairs: string[];
}

/** Owned weapons and perks for the level-up screen. */
export interface LoadoutItem {
  sprite: string;
  name: string;
  /** Tooltip lines. */
  details: string[];
  level: number;
  max: number;
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
  /** Weapons and perks bought for emeralds. */
  unlocks: string[];
  /** Already earned achievements. */
  achievements: string[];
}

/** Presentation constants (not balance). */
const EFFECT_POOL_SIZE = 128;
const FLAMES_PER_ZONE = 7;
const HERO_DEATH_DELAY_MS = 900;
const VICTORY_DELAY_MS = 1800;
const SUMMON_RING = 36;
/** Spacing of a pack spawned together and of the pieces of a split enemy (presentation). */
const PACK_RING = 18;
const SPLIT_RING = 10;
const HIT_FLASH_MS = 50;
const LABEL_POOL_SIZE = 8;
const HIT_FLASH_GAP_MS = 120;
const REWARD_RING = 20;
const TOAST_MS = 3500;
/** Turns further apart than this are not a row. */
const FLIP_GAP_MS = 600;
const HERO_PRESS_RADIUS = 16;
const AUTOPILOT_LOOT_RANGE = 260;
/** Mortar shells drop from this height during the last part of their flight. */
const SHELL_HEIGHT = 150;
const SHELL_FALL_MS = 350;
const NO_POINTS: ReadonlySet<Point> = new Set();

/** Adapts a pooled enemy sprite to the Mob interface used by AI behaviors. */
class SpriteMob implements Mob {
  readonly memory: Record<string, number> = {};
  readonly hitAt: Record<string, number> = {};
  definition!: EnemyDefinition;
  hp = 0;
  maxHp = 1;
  speedMultiplier = 1;
  telegraphing = false;
  burrowed = false;
  /** Run time when the white hit flash ends (0 = no flash). */
  flashUntil = 0;
  frozen = false;
  /** Run time until which this one enemy stays frozen. */
  chilledUntil = 0;
  /** Damage a mini-boss or boss may still take now; refills over time. */
  lossBudget = Infinity;

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

  setBurrowed(on: boolean): void {
    this.burrowed = on;
    this.sprite.setAlpha(on ? 0.3 : 1);
  }

  /** Active and above ground: can be shot, hit and can hurt the hero. */
  get targetable(): boolean { return this.sprite.active && !this.burrowed; }

  reset(definition: EnemyDefinition, hp: number, speedMultiplier: number): void {
    this.definition = definition;
    this.speedMultiplier = speedMultiplier;
    this.hp = hp;
    this.maxHp = hp;
    this.telegraphing = false;
    this.setBurrowed(false);
    this.flashUntil = 0;
    this.frozen = false;
    this.chilledUntil = 0;
    this.lossBudget = Infinity;
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

interface PendingBlast extends BlastSpec {
  at: number;
  shell: Phaser.GameObjects.Image;
}

export class RunScene extends Phaser.Scene {
  readonly view: RunView = {
    hp: 0, maxHp: 0, xp: 0, nextXp: 0, level: 1, kills: 0, caps: 0, seconds: 0,
    wave: 1, enemyCount: 0, projectileCount: 0, seed: 0, boss: null, warning: '',
    rerolls: 0, revives: 0, buffs: [], emeralds: 0, toast: '',
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
  private blasts: PendingBlast[] = [];
  private beams: [Point, Point][] = [];
  private unlocks = new Set<string>();
  private record: RunRecord = newRecord(0);
  private reported = new Set<string>();
  private ownedAchievements = new Set<string>();
  private bossSpawnedAt = 0;
  private checkedSecond = -1;
  private flipAt = -Infinity;
  private flipRow = 0;
  private facing = 0;
  /** Free level-ups left to show at the start. */
  private headStart = 0;
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
  private buffs = new Map<string, { stat: StatKey; amount: number; until: number; durationMs: number }>();
  private frozenUntil = 0;
  private hazardClock = 0;
  private invulnerableUntil = 0;
  private hazardSlow = 0;
  private prompt!: Phaser.GameObjects.Text;
  private hintGraphics!: Phaser.GameObjects.Graphics;

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
    this.blasts = [];
    this.beams = [];
    this.unlocks = new Set(data.unlocks);
    this.record = newRecord(new Date().getHours(), shelterState.knocks);
    shelterState.knocks = 0;
    this.flipAt = -Infinity;
    this.flipRow = 0;
    this.facing = 0;
    this.reported = new Set();
    this.ownedAchievements = new Set(data.achievements);
    this.headStart = Math.floor(this.stat('headStart'));
    this.checkedSecond = -1;
    this.orbiters = new Map();
    this.auras = new Map();
    this.mobs = [];
    this.buffs = new Map();
    this.frozenUntil = 0;
    this.hazardClock = 0;
    this.hazardSlow = 0;
    this.invulnerableUntil = 0;
    Object.assign(this.view, {
      hp: this.stat('maxHp'), maxHp: this.stat('maxHp'), xp: 0,
      nextXp: this.catalog.balance.xp.base, level: 1, kills: 0, caps: 0,
      seconds: Math.floor(this.elapsedMs / 1000), wave: this.waveIndex + 1,
      enemyCount: 0, projectileCount: 0, seed: data.seed, boss: null, warning: '',
      rerolls: Math.floor(this.stat('rerolls')), revives: Math.floor(this.stat('revives')), buffs: [], emeralds: 0, toast: '',
    });
    inputState.x = 0;
    inputState.y = 0;
    inputState.mouse.cancel();
  }

  create(): void {
    const limits = this.catalog.balance.run;
    this.physics.world.setBounds(-100000, -100000, 200000, 200000);
    this.ground = this.add.tileSprite(0, 0, this.scale.width, this.scale.height, this.location.groundSprite)
      .setOrigin(0).setScrollFactor(0).setDepth(-100);
    onLayoutChange(this, () => this.ground.setSize(this.scale.width, this.scale.height));
    this.hero = this.physics.add.sprite(0, 0, ATLAS, this.heroDefinition.sprite).setDepth(10);
    // The body stays small and sits on the feet of the taller sprite.
    (this.hero.body as Phaser.Physics.Arcade.Body).setSize(12, 14).setOffset(6, 9);
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
    this.decor = new WorldDecor(this, this.view.seed, this.location.decor, this.crates, this.catalog);

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
        sprite: 'fx/fire', pull: 0, nextTick: 0, until: 0, flames,
      });
    }
    this.prompt = this.add.text(0, 0, '', textStyle(8, COLORS.bright, { align: 'center' }))
      .setOrigin(0.5, 1).setDepth(31).setVisible(false);
    this.hintGraphics = this.add.graphics().setScrollFactor(0).setDepth(32);
    this.createContexts();

    this.physics.add.overlap(this.projectiles, this.enemies, (first, second) => {
      const bullet = first as Phaser.Physics.Arcade.Sprite;
      const mob = (second as Phaser.Physics.Arcade.Sprite).getData('mob') as SpriteMob;
      if (!bullet.active || !mob.targetable) return;
      const hits = bullet.getData('hits') as Set<number>;
      if (hits.has(mob.uid)) return;
      hits.add(mob.uid);
      this.consumeBullet(bullet);
      if (this.blast(bullet)) return;
      const chill = bullet.getData('chillMs') as number;
      if (chill) mob.chilledUntil = this.elapsedMs + chill;
      this.damageMob(mob, bullet.getData('damage') as number, bullet.x, bullet.y);
    });
    this.physics.add.overlap(this.projectiles, this.crates, (first, second) => {
      const bullet = first as Phaser.Physics.Arcade.Sprite;
      const crate = second as Phaser.Physics.Arcade.Sprite;
      if (!bullet.active || !crate.active) return;
      this.consumeBullet(bullet);
      if (this.blast(bullet)) return;
      this.hitCrate(crate, bullet.getData('damage') as number);
    });
    this.physics.add.overlap(this.hero, this.crates, (_hero, crate) => {
      const sprite = crate as Phaser.Physics.Arcade.Sprite;
      if (sprite.active) this.hitCrate(sprite, Infinity);
    });
    this.physics.add.overlap(this.hero, this.enemies, (_hero, item) => {
      const mob = (item as Phaser.Physics.Arcade.Sprite).getData('mob') as SpriteMob;
      if (!mob.targetable) return;
      if (!this.takeDamage(mob.definition.stats.damage)) return;
      const thorns = this.stat('thorns');
      if (thorns > 0) this.damageMob(mob, thorns, mob.x, mob.y);
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
    if (this.autopilotOn) void keepAwake(true);
    playSfx('sfx/run_start');
    playTune(settings().runTune, this.location.music);
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
      nearestTo: (center, range, skip) => this.nearestTo(center, range, skip),
      strike: (target, damage) => this.strike(target, damage),
      drawBolt: (path, sprite) => this.drawBolt(path, sprite),
      damageInRadius: (center, radius, damage, limit) => this.damageInRadius(center, radius, damage, limit),
      spawnProjectile: (spec) => this.spawnProjectile(spec),
      spawnZone: (spec) => this.spawnZone(spec),
      scheduleBlast: (spec) => this.scheduleBlast(spec),
      drawBeam: (from, to) => { this.beams.push([from, to]); },
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
      summon: (enemyId, count, around) => this.summon(enemyId, count, around, SUMMON_RING),
      shockwave: (center, radius, damage) => {
        this.playEffect('fx/dust', 'burst', center.x, center.y, false);
        playSfx('sfx/crate_break');
        this.cameras.main.shake(80, 0.004);
        if (Phaser.Math.Distance.Between(center.x, center.y, this.hero.x, this.hero.y) <= radius) {
          this.takeDamage(damage, true);
        }
      },
      healAround: (healer, radius, fraction) => {
        let healed = 0;
        for (const mob of this.mobs) {
          // Only ordinary enemies: healing elites or a boss by a share of their HP is far too strong.
          if (mob === healer || !mob.targetable || mob.definition.role !== 'normal' || mob.hp >= mob.maxHp) continue;
          if (Phaser.Math.Distance.Between(mob.x, mob.y, healer.x, healer.y) > radius) continue;
          mob.hp = Math.min(mob.maxHp, mob.hp + mob.maxHp * fraction);
          healed += 1;
        }
        this.playEffect('fx/heal', 'burst', healer.x, healer.y, false);
        return healed;
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
      addBuff: (id, stat, amount, durationMs) => {
        const lasts = durationMs * (1 + this.stat('buffDuration'));
        this.buffs.set(id, { stat, amount, until: this.elapsedMs + lasts, durationMs: lasts });
      },
      addXpFraction: (fraction) => { this.gainXp(this.view.nextXp * fraction); },
      freezeEnemies: (durationMs) => {
        this.frozenUntil = this.elapsedMs + durationMs;
        this.cameras.main.flash(160, 160, 220, 255);
      },
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
    this.updateRecord(delta);
    if (this.headStart > 0 && this.scene.isActive()) {
      this.headStart -= 1;
      this.gainXp(this.view.nextXp - this.view.xp);
      return;
    }

    const regen = this.stat('regen');
    if (regen > 0) this.view.hp = Math.min(this.view.maxHp, this.view.hp + regen * delta / 1000);
    this.updateBuffs();
    this.updateHazards(delta);
    if (this.finished) return;
    this.moveHero(delta);
    const camera = this.cameras.main;
    this.ground.tilePositionX = camera.scrollX;
    this.ground.tilePositionY = camera.scrollY;
    this.decor.update(camera.worldView);

    const interval = this.currentWave().spawnIntervalMs;
    this.spawnClock += delta;
    while (this.spawnClock >= interval) {
      this.spawnClock -= interval;
      this.spawnWaveEntry();
    }
    this.moveEnemies(delta);
    this.steerProjectiles(delta);
    this.expire(this.projectiles);
    this.expire(this.hostileShots);
    this.updateZones(delta);
    this.updateBlasts();
    this.updateLoot();
    if (!this.finished && this.scene.isActive()) this.updateLandmarks(delta);
    this.auras.clear();
    this.beams.length = 0;
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
        this.announceElite();
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
        this.bossSpawnedAt = this.elapsedMs;
        this.spawnEnemy(definition);
        this.announceElite();
        playMusic(this.location.bossMusic);
      }
    }
  }

  private announceElite(): void {
    playSfx('sfx/elite_roar');
    this.cameras.main.shake(350, 0.008);
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
    for (const buff of this.buffs.values()) {
      if (buff.stat === key && buff.until > this.elapsedMs) flat += buff.amount;
    }
    return (this.heroDefinition.baseStats[key] + flat) * (1 + percent);
  }

  get autopilotOwned(): boolean {
    return this.stat('autopilot') > 0;
  }

  get autopilotOn(): boolean {
    return settings().autopilot && this.autopilotOwned;
  }

  private autopilotStep(): Point | null {
    const threats: Threat[] = [];
    for (const mob of this.mobs) {
      if (mob.targetable) threats.push({ x: mob.x, y: mob.y, big: mob.definition.role !== 'normal' });
    }
    const shots = (this.hostileShots.getChildren() as Phaser.Physics.Arcade.Sprite[])
      .filter((shot) => shot.active);
    let loot: Point | null = null;
    let best = AUTOPILOT_LOOT_RANGE;
    for (const group of [this.crystals, this.pickups]) {
      for (const item of group.getChildren() as Phaser.Physics.Arcade.Sprite[]) {
        if (!item.active) continue;
        const distance = Math.hypot(item.x - this.hero.x, item.y - this.hero.y);
        if (distance >= best) continue;
        best = distance;
        loot = item;
      }
    }
    return autopilotDirection(this.hero, threats, shots, loot);
  }

  /** A press on the canvas: presses on the hero in a row are counted. */
  heroPress(x: number, y: number): void {
    const { scrollX, scrollY } = this.cameras.main;
    const hit = Math.hypot(x + scrollX - this.hero.x, y + scrollY - this.hero.y) <= HERO_PRESS_RADIUS;
    this.record.heroClicks = hit ? this.record.heroClicks + 1 : 0;
    this.checkAchievements();
  }

  notePause(): void {
    this.record.pauses += 1;
    this.checkAchievements();
  }

  private updateRecord(delta: number): void {
    if (this.autopilotOn) this.record.autopilotMs += delta;
    this.record.seconds = this.view.seconds;
    this.record.kills = this.view.kills;
    this.record.bossSpawned = this.bossSpawned;
    if (this.view.seconds === this.checkedSecond) return;
    this.checkedSecond = this.view.seconds;
    this.checkAchievements();
  }

  private checkAchievements(): void {
    for (const achievement of Object.values(this.catalog.achievements)) {
      if (this.ownedAchievements.has(achievement.id) || this.reported.has(achievement.id)
        || !isReached(achievement, this.record)) continue;
      this.reported.add(achievement.id);
      if (this.record.end) continue;
      playSfx('sfx/chest_jackpot');
      this.view.toast = `ДОСТИЖЕНИЕ: ${achievement.name.toUpperCase()}`;
      // Scene time stands still on pause, so the banner waits for the run to go on.
      this.time.delayedCall(TOAST_MS, () => { this.view.toast = ''; });
    }
  }

  private recordMovement(x: number, y: number, delta: number): void {
    if (x === 0 && y === 0) {
      this.record.idleMs += delta;
      return;
    }
    this.record.moved = true;
    const side = Math.sign(Math.round(x * 2));
    if (!side || side === this.facing) return;
    if (this.facing) {
      this.flipRow = this.elapsedMs - this.flipAt <= FLIP_GAP_MS ? this.flipRow + 1 : 1;
      this.record.flips = Math.max(this.record.flips, this.flipRow);
      this.flipAt = this.elapsedMs;
    }
    this.facing = side;
  }

  get levelUpTimeoutMs(): number {
    return this.catalog.balance.run.levelUpTimeoutMs;
  }

  /** The player did not choose in time. */
  randomChoice(): UpgradeChoice | undefined {
    this.record.autoPicks += 1;
    return this.choices[Math.floor(this.rng.next() * this.choices.length)];
  }

  private moveHero(delta: number): void {
    let x = inputState.x;
    let y = inputState.y;
    if (this.keys.A.isDown || this.cursors.left.isDown) x -= 1;
    if (this.keys.D.isDown || this.cursors.right.isDown) x += 1;
    if (this.keys.W.isDown || this.cursors.up.isDown) y -= 1;
    if (this.keys.S.isDown || this.cursors.down.isDown) y += 1;
    if (x !== 0 || y !== 0) {
      inputState.mouse.cancel();
    } else {
      const way = inputState.mouse.direction(this.hero,
        (point) => this.cameras.main.getWorldPoint(point.x, point.y));
      if (way) ({ x, y } = way);
      else if (this.autopilotOn) ({ x, y } = this.autopilotStep() ?? { x: 0, y: 0 });
    }
    this.recordMovement(x, y, delta);
    const length = Math.hypot(x, y);
    const { softMoveSpeed, softMoveSpeedFactor } = this.catalog.balance.run;
    const speed = softCap(this.stat('moveSpeed'), softMoveSpeed, softMoveSpeedFactor) * (1 - this.hazardSlow);
    this.hero.setVelocity(length > 0 ? (x / length) * speed : 0,
      length > 0 ? (y / length) * speed : 0);
    const sprite = this.heroDefinition.sprite;
    if (length > 0) {
      if (x !== 0) this.hero.setFlipX(x < 0);
      this.hero.anims.play(animationKey(sprite, 'walk'), true);
    } else {
      this.hero.anims.play(animationKey(sprite, 'idle'), true);
    }
  }

  // --- enemies -----------------------------------------------------------------------

  /** One weighted pick from the wave; a `group` entry arrives as a pack around one spot. */
  private spawnWaveEntry(): void {
    const entries = this.currentWave().enemies;
    let total = 0;
    for (const entry of entries) total += entry.weight;
    let roll = this.rng.next() * total;
    let picked = entries.at(-1)!;
    for (const entry of entries) {
      roll -= entry.weight;
      if (roll < 0) {
        picked = entry;
        break;
      }
    }
    const definition = this.catalog.enemies[picked.id]!;
    if (picked.group <= 1) {
      this.spawnEnemy(definition);
      return;
    }
    const angle = this.rng.next() * Math.PI * 2;
    const distance = this.catalog.balance.run.spawnDistance;
    const x = this.hero.x + Math.cos(angle) * distance;
    const y = this.hero.y + Math.sin(angle) * distance;
    for (let index = 0; index < picked.group; index += 1) {
      const offset = (index / picked.group) * Math.PI * 2;
      this.spawnEnemy(definition, x + Math.cos(offset) * PACK_RING, y + Math.sin(offset) * PACK_RING);
    }
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
    const fit = definition.role === 'normal' ? 0.8 : 0.65;
    sprite.setScale(definition.scale);
    (sprite.body as Phaser.Physics.Arcade.Body).setSize(sprite.width * fit, sprite.height * fit);
    sprite.setVelocity(0, 0).setDepth(definition.role === 'normal' ? 0 : 6);
    const speed = definition.role === 'normal' ? this.currentWave().speedMultiplier : 1;
    const mob = sprite.getData('mob') as SpriteMob;
    mob.reset(definition, definition.stats.hp * multiplier, speed);
    if (definition.role !== 'normal') mob.lossBudget = mob.maxHp * this.maxLoss(definition);
    const walk = animationKey(definition.sprite, 'walk');
    // A frozen enemy dies with its animation paused; the pooled sprite must start clean.
    sprite.anims.resume();
    if (this.anims.exists(walk)) {
      // Visual-only phase offset: a counter, so the seeded gameplay RNG stream is untouched.
      this.spawnCount += 1;
      sprite.anims.play({ key: walk, startFrame: this.spawnCount % 4 });
    }
  }

  private moveEnemies(delta: number): void {
    const maxDistanceSquared = this.catalog.balance.run.despawnDistance ** 2;
    let frozenCount = 0;
    for (const mob of this.mobs) {
      const sprite = mob.sprite;
      if (!sprite.active) continue;
      if (mob.definition.role !== 'normal') {
        mob.lossBudget = refillBudget(mob.lossBudget, mob.maxHp * this.maxLoss(mob.definition), delta);
      }
      const dx = this.hero.x - sprite.x;
      const dy = this.hero.y - sprite.y;
      if (mob.definition.role === 'normal' && dx * dx + dy * dy > maxDistanceSquared) {
        sprite.disableBody(true, true);
        continue;
      }
      sprite.setFlipX(dx < 0);
      if (mob.flashUntil && this.elapsedMs >= mob.flashUntil) {
        mob.flashUntil = 0;
        if (mob.frozen) sprite.setTint(0x8ad0ff).setTintMode(Phaser.TintModes.MULTIPLY);
        else if (!mob.telegraphing) sprite.clearTint();
      }
      const definition = mob.definition;
      const frozen = this.elapsedMs < Math.max(this.frozenUntil, mob.chilledUntil) && definition.role === 'normal' && !mob.burrowed;
      if (frozen !== mob.frozen) {
        mob.frozen = frozen;
        if (frozen) {
          sprite.setTint(0x8ad0ff).setTintMode(Phaser.TintModes.MULTIPLY);
          sprite.anims.pause();
        } else {
          sprite.clearTint();
          sprite.anims.resume();
        }
      }
      if (frozen) {
        frozenCount += 1;
        mob.setVelocity(0, 0);
        continue;
      }
      enemyBehaviors[definition.ai.type]!.update(mob, this.enemyContext, definition.ai.params, delta);
    }
    this.record.frozen = Math.max(this.record.frozen, frozenCount);
  }

  private maxLoss(definition: EnemyDefinition): number {
    const { eliteMaxLossPerSecond, bossMaxLossPerSecond } = this.catalog.balance.run;
    return definition.role === 'boss' ? bossMaxLossPerSecond : eliteMaxLossPerSecond;
  }

  private damageMob(mob: SpriteMob, amount: number, x: number, y: number): void {
    const chance = this.stat('critChance');
    if (chance > 0 && this.rng.next() < chance) {
      amount *= this.catalog.balance.run.critMultiplier + this.stat('critDamage');
      this.playEffect('fx/hit', 'burst', x, y - 4, true);
    }
    if (mob.definition.role !== 'normal') {
      amount = Math.min(mob.lossBudget, amount * (1 + this.stat('eliteDamage')));
      mob.lossBudget -= amount;
    }
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

  private summon(enemyId: string, count: number, around: Point, ring: number): void {
    const definition = this.catalog.enemies[enemyId];
    if (!definition) return;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      this.spawnEnemy(definition, around.x + Math.cos(angle) * ring,
        around.y + Math.sin(angle) * ring, this.currentWave().hpMultiplier);
    }
  }

  private killMob(mob: SpriteMob): void {
    const { sprite, definition } = mob;
    const { x, y } = sprite;
    this.playEffect(definition.sprite, 'death', x, y, sprite.flipX, definition.scale);
    if (definition.role === 'normal') playSfx('sfx/enemy_death');
    else {
      playSfx('sfx/explosion');
      this.playEffect('fx/explosion', 'burst', x, y, false);
      this.cameras.main.shake(200, 0.01);
    }
    sprite.clearTint();
    sprite.disableBody(true, true);
    this.view.kills += 1;
    const healed = this.stat('killHeal');
    if (healed > 0) this.view.hp = Math.min(this.view.maxHp, this.view.hp + healed);
    if (definition.role !== 'normal') {
      const { elite, boss } = this.location.emeralds;
      const emeralds = definition.role === 'boss' ? boss : elite;
      this.view.emeralds += emeralds;
      if (emeralds) {
        this.label(`+${emeralds} ИЗУМРУД`, '#9bff6e');
        playSfx('sfx/emerald');
      }
    }
    this.killsByType[definition.id] = (this.killsByType[definition.id] ?? 0) + 1;
    if (definition.stats.xp > 0) this.dropXp(x, y, definition.stats.xp);
    this.rollDrops(definition, x, y);
    if (definition.split) this.summon(definition.split.enemy, definition.split.count, { x, y }, SPLIT_RING);
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
    this.record.bossSeconds = (this.elapsedMs - this.bossSpawnedAt) / 1000;
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

  /** Nearest enemy, but an elite or boss inside `eliteFocusRange` comes first. */
  private nearestEnemy(): Point | null {
    let nearest: Point | null = null;
    let best = Infinity;
    let focus: Point | null = null;
    let focusBest = this.catalog.balance.run.eliteFocusRange ** 2;
    for (const mob of this.mobs) {
      if (!mob.targetable) continue;
      if (mob.definition.role !== 'normal') {
        const distance = this.distanceSquared(mob.sprite);
        if (distance <= focusBest) {
          focus = mob.sprite;
          focusBest = distance;
        }
      }
      const dx = mob.sprite.x - this.hero.x;
      const dy = mob.sprite.y - this.hero.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < best) {
        nearest = mob.sprite;
        best = distanceSquared;
      }
    }
    return focus ?? nearest;
  }

  private randomEnemyWithin(range: number): Point | null {
    const rangeSquared = range * range;
    let count = 0;
    for (const mob of this.mobs) {
      if (mob.targetable && this.distanceSquared(mob.sprite) <= rangeSquared) count += 1;
    }
    if (!count) return null;
    let pick = Math.floor(this.rng.next() * count);
    for (const mob of this.mobs) {
      if (!mob.targetable || this.distanceSquared(mob.sprite) > rangeSquared) continue;
      if (pick === 0) return mob.sprite;
      pick -= 1;
    }
    return null;
  }

  private nearestTo(center: Point, range: number, skip: ReadonlySet<Point>): Point | null {
    let nearest: Point | null = null;
    let best = range * range;
    for (const mob of this.mobs) {
      if (!mob.targetable || skip.has(mob.sprite)) continue;
      const dx = mob.sprite.x - center.x;
      const dy = mob.sprite.y - center.y;
      const distance = dx * dx + dy * dy;
      if (distance > best) continue;
      nearest = mob.sprite;
      best = distance;
    }
    return nearest;
  }

  private strike(target: Point, damage: number): void {
    // Targets are the enemy sprites handed out by the searches above.
    const mob = (target as Phaser.Physics.Arcade.Sprite).getData('mob') as SpriteMob;
    if (mob.targetable) this.damageMob(mob, damage, target.x, target.y);
  }

  /** Jagged lightning that fades out; the jitter is visual only and does not use the run RNG. */
  private drawBolt(path: readonly Point[], sprite: string): void {
    const bolt = this.add.graphics().setDepth(13);
    for (const [width, color, alpha] of [[3, 0x649388, 0.5], [1, 0xf0e8cf, 1]] as const) {
      bolt.lineStyle(width, color, alpha).beginPath().moveTo(path[0]!.x, path[0]!.y);
      for (let index = 1; index < path.length; index += 1) {
        const from = path[index - 1]!;
        const to = path[index]!;
        for (let step = 1; step < 4; step += 1) {
          const wobble = ((index * 7 + step * 5) % 9) - 4;
          const t = step / 4;
          bolt.lineTo(from.x + (to.x - from.x) * t + wobble, from.y + (to.y - from.y) * t - wobble);
        }
        bolt.lineTo(to.x, to.y);
      }
      bolt.strokePath();
    }
    const tip = path.at(-1)!;
    const spark = this.add.image(tip.x, tip.y, ATLAS, sprite).setDepth(13);
    this.tweens.add({
      targets: [bolt, spark], alpha: 0, duration: 160,
      onComplete: () => { bolt.destroy(); spark.destroy(); },
    });
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
      if (!mob.targetable) continue;
      const reach = radius + sprite.displayWidth / 3;
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
    bullet.enableBody(true, spec.at?.x ?? this.hero.x, spec.at?.y ?? this.hero.y, true, true);
    (bullet.body as Phaser.Physics.Arcade.Body).setSize(bullet.width, bullet.height);
    (bullet.getData('hits') as Set<number>).clear();
    bullet.setData('damage', spec.damage).setData('pierce', spec.pierce)
      .setData('expiresAt', this.elapsedMs + spec.lifetimeMs)
      .setData('blastRadius', spec.blastRadius ?? 0).setData('turnRate', spec.turnRate ?? 0)
      .setData('returnAt', spec.returnAfterMs === undefined ? 0 : this.elapsedMs + spec.returnAfterMs)
      .setData('chillMs', spec.chillMs ?? 0)
      .setData('returnSpeed', spec.returnSpeed ?? 0).setData('returning', false);
    bullet.stop();
    for (const name of ['spin', 'idle', 'burn']) {
      const key = animationKey(spec.sprite, name);
      if (this.anims.exists(key)) bullet.play({ key, repeat: -1 });
    }
    bullet.setVelocity(spec.vx, spec.vy).setRotation(Math.atan2(spec.vy, spec.vx));
  }

  private consumeBullet(bullet: Phaser.Physics.Arcade.Sprite): void {
    const pierce = bullet.getData('pierce') as number;
    if (pierce > 0) bullet.setData('pierce', pierce - 1);
    else bullet.disableBody(true, true);
  }

  /** Explosive projectiles damage an area instead of one target. */
  private blast(bullet: Phaser.Physics.Arcade.Sprite): boolean {
    const radius = bullet.getData('blastRadius') as number;
    if (!radius) return false;
    this.playEffect('fx/explosion', 'burst', bullet.x, bullet.y, false);
    playSfx('sfx/explosion', 0.5);
    this.damageInRadius({ x: bullet.x, y: bullet.y }, radius, bullet.getData('damage') as number);
    return true;
  }

  /** Homing rockets turn to the nearest enemy; boomerangs fly back to the hero. */
  private steerProjectiles(delta: number): void {
    for (const item of this.projectiles.getChildren()) {
      const bullet = item as Phaser.Physics.Arcade.Sprite;
      if (!bullet.active) continue;
      const turnRate = bullet.getData('turnRate') as number;
      const returnAt = bullet.getData('returnAt') as number;
      if (turnRate) {
        const target = this.nearestTo(bullet, Infinity, NO_POINTS);
        if (!target) continue;
        const { velocity } = bullet.body as Phaser.Physics.Arcade.Body;
        const speed = velocity.length();
        const angle = Phaser.Math.Angle.RotateTo(velocity.angle(),
          Math.atan2(target.y - bullet.y, target.x - bullet.x), turnRate * delta / 1000);
        bullet.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed).setRotation(angle);
      } else if (returnAt && this.elapsedMs >= returnAt) {
        if (!bullet.getData('returning')) {
          bullet.setData('returning', true);
          (bullet.getData('hits') as Set<number>).clear();
        }
        const dx = this.hero.x - bullet.x;
        const dy = this.hero.y - bullet.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= this.catalog.balance.run.collectRadius) {
          bullet.disableBody(true, true);
          continue;
        }
        const speed = bullet.getData('returnSpeed') as number;
        bullet.setVelocity((dx / distance) * speed, (dy / distance) * speed);
      }
    }
  }

  private spawnZone(spec: ZoneSpec): void {
    const zone = this.zones.find((candidate) => !candidate.active);
    if (!zone) return;
    Object.assign(zone, { pull: 0 }, spec, {
      active: true, nextTick: this.elapsedMs, until: this.elapsedMs + spec.durationMs,
    });
    zone.flames.forEach((flame, index) => {
      const angle = (index / (FLAMES_PER_ZONE - 1)) * Math.PI * 2;
      const distance = index === 0 ? 0 : spec.radius * 0.6;
      flame.setPosition(spec.x + Math.cos(angle) * distance, spec.y + Math.sin(angle) * distance)
        .setVisible(true).play({ key: animationKey(spec.sprite, 'burn'), startFrame: index % 3 });
    });
  }

  private scheduleBlast(spec: BlastSpec): void {
    const shell = this.add.image(spec.x, spec.y - SHELL_HEIGHT, ATLAS, spec.sprite)
      .setDepth(13).setFlipY(true).setVisible(false);
    this.blasts.push({ ...spec, at: this.elapsedMs + spec.delayMs, shell });
  }

  private updateBlasts(): void {
    const due: PendingBlast[] = [];
    this.blasts = this.blasts.filter((blast) => {
      const left = blast.at - this.elapsedMs;
      if (left <= 0) {
        due.push(blast);
        return false;
      }
      const fall = Math.min(1, left / SHELL_FALL_MS);
      blast.shell.setVisible(fall < 1).setY(blast.y - SHELL_HEIGHT * fall);
      return true;
    });
    for (const blast of due) {
      blast.shell.destroy();
      this.playEffect('fx/explosion', 'burst', blast.x, blast.y, false, blast.radius / 24);
      playSfx('sfx/explosion', 0.5);
      this.damageInRadius(blast, blast.radius, blast.damage);
    }
  }

  private pullEnemies(zone: Zone, strength: number, delta: number): void {
    for (const mob of this.mobs) {
      if (!mob.targetable || mob.definition.role !== 'normal') continue;
      const dx = zone.x - mob.x;
      const dy = zone.y - mob.y;
      const distance = Math.hypot(dx, dy);
      if (distance > zone.radius * 1.5 || distance < 4) continue;
      const step = Math.min(distance, strength * delta / 1000);
      mob.sprite.setPosition(mob.x + (dx / distance) * step, mob.y + (dy / distance) * step);
    }
  }

  private updateZones(delta: number): void {
    for (const zone of this.zones) {
      if (!zone.active) continue;
      if (this.elapsedMs >= zone.until) {
        zone.active = false;
        for (const flame of zone.flames) flame.stop().setVisible(false);
        continue;
      }
      if (zone.pull) this.pullEnemies(zone, zone.pull, delta);
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
      if (zone.active) graphics.fillStyle(zone.pull ? 0x8a559c : 0xd9602a, 0.18).fillCircle(zone.x, zone.y, zone.radius);
    }
    for (const blast of this.blasts) {
      graphics.lineStyle(1, 0xff7d6b, 0.5 + 0.4 * pulse).strokeCircle(blast.x, blast.y, blast.radius);
    }
    for (const [from, to] of this.beams) {
      graphics.lineStyle(7, 0xd9602a, 0.35).lineBetween(from.x, from.y, to.x, to.y);
      graphics.lineStyle(3, 0xecc962, 0.9).lineBetween(from.x, from.y, to.x, to.y);
    }
    this.drawElites(graphics, pulse);
    this.decor.eachLandmark((landmark) => {
      if (landmark.used) return;
      const { radius } = landmark.definition.trigger;
      graphics.lineStyle(1, 0xf2c46b, 0.25 + 0.25 * pulse).strokeCircle(landmark.x, landmark.y, radius);
      if (landmark.progress <= 0) return;
      graphics.lineStyle(3, 0xf2c46b, 0.9).beginPath()
        .arc(landmark.x, landmark.y, radius, -Math.PI / 2, -Math.PI / 2 + landmark.progress * Math.PI * 2)
        .strokePath();
    });
  }

  /** A warning ring under every mini-boss and boss, and their own HP bar. */
  private drawElites(graphics: Phaser.GameObjects.Graphics, pulse: number): void {
    for (const mob of this.mobs) {
      if (!mob.targetable || mob.definition.role === 'normal') continue;
      const { sprite } = mob;
      const width = sprite.displayWidth;
      const foot = sprite.y + sprite.displayHeight * 0.42;
      graphics.fillStyle(0xd9402a, 0.2 + 0.15 * pulse).fillEllipse(sprite.x, foot, width * 1.1, width * 0.4);
      graphics.lineStyle(2, 0xff7d6b, 0.5 + 0.4 * pulse).strokeEllipse(sprite.x, foot, width * 1.1, width * 0.4);
      const top = sprite.y - sprite.displayHeight / 2 - 6;
      graphics.fillStyle(0x16120f, 0.9).fillRect(sprite.x - 22, top, 44, 5);
      graphics.fillStyle(COLORS.hp, 1).fillRect(sprite.x - 21, top + 1, Math.round(42 * mob.hpFraction), 3);
    }
  }

  // --- map: bonuses, hazards, landmarks -----------------------------------------------

  private updateBuffs(): void {
    const buffs: RunView['buffs'] = [];
    for (const [id, buff] of this.buffs) {
      const left = buff.until - this.elapsedMs;
      if (left <= 0) this.buffs.delete(id);
      else {
        const { sprite, name } = this.catalog.pickups[id]!;
        buffs.push({ sprite, name, text: statBonus(buff.stat, buff.amount),
          fraction: left / buff.durationMs });
      }
    }
    this.view.buffs = buffs;
  }

  /** Hazards hurt through armor but not through radResist, and never on the contact cooldown. */
  private updateHazards(delta: number): void {
    const { damagePerSecond, slow } = this.decor.hazardAt(this.hero.x, this.hero.y);
    const resist = Math.min(1, Math.max(0, this.stat('radResist')));
    this.hazardSlow = slow * (1 - resist);
    if (slow > 0 || damagePerSecond > 0) this.record.hazardMs += delta;
    const tick = this.catalog.balance.run.hazardTickMs;
    const damage = damagePerSecond * (1 - resist) * tick / 1000;
    if (damage <= 0) {
      this.hazardClock = 0;
      return;
    }
    this.hazardClock += delta;
    while (this.hazardClock >= tick && !this.finished) {
      this.hazardClock -= tick;
      this.hurt(damage);
    }
  }

  private updateLandmarks(delta: number): void {
    const { landmarkDecayRate, landmarkHintRange } = this.catalog.balance.run;
    const hints = this.hintGraphics.clear();
    const view = this.cameras.main.worldView;
    for (const mob of this.mobs) {
      if (mob.sprite.active && mob.definition.role !== 'normal' && !view.contains(mob.x, mob.y)) {
        this.drawHint(hints, mob, 0xff5a4a);
      }
    }
    const nearby: ActiveLandmark[] = [];
    this.decor.eachLandmark((landmark) => {
      if (landmark.used) return;
      const distance = Math.hypot(landmark.x - this.hero.x, landmark.y - this.hero.y);
      const { trigger } = landmark.definition;
      if (distance <= trigger.radius) {
        nearby.push(landmark);
        if (this.view.caps >= trigger.caps) landmark.progress += delta * (1 + this.stat('landmarkSpeed')) / trigger.holdMs;
      } else {
        landmark.progress = Math.max(0, landmark.progress - landmarkDecayRate * delta / trigger.holdMs);
        if (distance <= landmarkHintRange && !view.contains(landmark.x, landmark.y)) {
          this.drawHint(hints, landmark);
        }
      }
    });
    const closest = nearby[0];
    this.prompt.setVisible(Boolean(closest));
    if (!closest) return;
    const { definition } = closest;
    const { caps } = definition.trigger;
    const price = caps ? `\n${caps} крышек${this.view.caps < caps ? ' — не хватает' : ''}` : '';
    const text = `${definition.name.toUpperCase()}\n${definition.hint}${price}`;
    if (this.prompt.text !== text) this.prompt.setText(text);
    this.prompt.setPosition(closest.x, closest.y - definition.trigger.radius - 4);
    for (const landmark of nearby) {
      // Two landmarks may finish together: the price is checked again for each.
      if (landmark.progress >= 1 && this.view.caps >= landmark.definition.trigger.caps) {
        this.completeLandmark(landmark);
      }
    }
  }

  private completeLandmark(landmark: ActiveLandmark): void {
    const { definition } = landmark;
    this.decor.useLandmark(landmark);
    this.prompt.setVisible(false);
    this.view.caps -= definition.trigger.caps;
    this.record.landmarks += 1;
    if (definition.trigger.caps > 0 && this.view.caps === 0) this.record.broke = true;
    playSfx('sfx/landmark');
    const [min, max] = definition.rolls;
    const count = min + Math.floor(this.rng.next() * (max - min + 1));
    const total = definition.rewards.reduce((sum, reward) => sum + reward.weight, 0);
    for (let index = 0; index < count; index += 1) {
      let roll = this.rng.next() * total;
      const reward = definition.rewards.find((item) => (roll -= item.weight) < 0)
        ?? definition.rewards.at(-1)!;
      const angle = Math.PI / 2 + (index - (count - 1) / 2);
      this.spawnPickup(reward.pickup, landmark.x + Math.cos(angle) * REWARD_RING,
        landmark.y + Math.sin(angle) * REWARD_RING);
    }
    if (definition.ambush) {
      this.warn('!! ЗАСАДА !!');
      this.warningUntil = this.elapsedMs + 1200;
      for (let index = 0; index < definition.ambush.count; index += 1) this.spawnWaveEntry();
    }
  }

  /** Arrow at the screen edge towards an off-screen landmark. */
  private drawHint(graphics: Phaser.GameObjects.Graphics, target: Point, color = 0xf2c46b): void {
    const { width, height } = this.cameras.main;
    const angle = Math.atan2(target.y - this.hero.y, target.x - this.hero.x);
    const scale = Math.min((width / 2 - 12) / Math.max(0.001, Math.abs(Math.cos(angle))),
      (height / 2 - 36) / Math.max(0.001, Math.abs(Math.sin(angle))));
    const x = width / 2 + Math.cos(angle) * scale;
    const y = height / 2 + Math.sin(angle) * scale;
    const corner = (turn: number, size: number): [number, number] =>
      [x + Math.cos(angle + turn) * size, y + Math.sin(angle + turn) * size];
    graphics.fillStyle(color, 0.85)
      .fillTriangle(...corner(0, 6), ...corner(2.5, 5), ...corner(-2.5, 5));
  }

  // --- loot --------------------------------------------------------------------------

  private hitCrate(crate: Phaser.Physics.Arcade.Sprite, damage: number): void {
    const hp = (crate.getData('hp') as number) - damage;
    crate.setData('hp', hp);
    if (hp > 0) return;
    this.record.crates += 1;
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
      pickupEffects[definition.effect.type]!.apply(this.pickupContext, definition.effect.params, definition.id);
      const gained = this.view.caps - caps;
      this.label(gained > 0 ? `+${gained}` : `+${definition.name.toUpperCase()}`,
        gained > 0 ? COLORS.warn : COLORS.bright);
      return !this.scene.isActive();
    }
    pickupEffects[definition.effect.type]!.apply(this.pickupContext, definition.effect.params, definition.id);
    return !this.scene.isActive();
  }

  // --- progression -------------------------------------------------------------------

  private newWeaponState(): WeaponState {
    return { level: 1, clock: 0, activeUntil: 0, angle: 0 };
  }

  /** Everything that can be offered; new items need a free slot. */
  private upgradePool(ownedOnly: boolean): UpgradeChoice[] {
    const slots = this.slots;
    const heavyOwned = this.heavyOwned();
    const pool: UpgradeChoice[] = [];
    for (const weapon of Object.values(this.catalog.weapons)) {
      const owned = this.weapons.get(weapon.id);
      const full = weapon.heavy ? heavyOwned >= slots.heavy
        : this.weapons.size - heavyOwned >= slots.weapons;
      if (!owned && (ownedOnly || weapon.evolved || full || this.view.level < weapon.minHeroLevel
        || !this.isOpen(weapon) || this.hasEvolved(weapon))) continue;
      if (owned && owned.level >= weapon.levels.length) continue;
      const changes = owned
        ? levelChanges(weapon.levels[owned.level - 1]!, weapon.levels[owned.level]!) : [];
      pool.push({ kind: 'weapon', id: weapon.id, name: weapon.name, sprite: weapon.sprite,
        description: owned ? [`Уровень ${owned.level + 1}`, ...changes].join('\n') : `${weapon.heavy ? 'Тяжёлое оружие' : 'Новое оружие'}\n${weapon.description}`,
        pairs: weapon.evolution ? [this.catalog.passives[weapon.evolution.passive]!.sprite] : [] });
    }
    for (const passive of Object.values(this.catalog.passives)) {
      const level = this.ownedPassives.get(passive.id) ?? 0;
      if (!level && (ownedOnly || this.ownedPassives.size >= slots.passives)) continue;
      if (level >= passive.maxLevel || (!level && !this.isOpen(passive))) continue;
      pool.push({ kind: 'passive', id: passive.id, name: passive.name, sprite: passive.sprite,
        description: `${level ? `Уровень ${level + 1}` : 'Новый перк'}\n${
          statBonus(passive.stat, passive.perLevel, passive.mod)}`,
        pairs: [...this.weapons.keys()].map((id) => this.catalog.weapons[id]!)
          .filter((weapon) => weapon.evolution?.passive === passive.id).map((weapon) => weapon.sprite) });
    }
    return pool;
  }

  private heavyOwned(): number {
    let count = 0;
    for (const id of this.weapons.keys()) if (this.catalog.weapons[id]!.heavy) count += 1;
    return count;
  }

  private isOpen(item: WeaponDefinition | PassiveDefinition): boolean {
    return item.unlock.type === 'default' || this.unlocks.has(item.id);
  }

  /** The evolved form is already in hand, so the base weapon must not come back. */
  private hasEvolved(weapon: { evolution?: { into: string } | undefined }): boolean {
    return weapon.evolution !== undefined && this.weapons.has(weapon.evolution.into);
  }

  /** Every slot the shelter can give, for the HUD. */
  get maxSlots(): { weapons: number; passives: number } {
    const { maxWeapons, maxPassives } = this.catalog.balance.run;
    return { weapons: maxWeapons, passives: maxPassives };
  }

  /** How many weapons, heavy weapons and perks fit into one run. */
  get slots(): { weapons: number; heavy: number; passives: number } {
    const { maxWeapons, maxHeavyWeapons, maxPassives } = this.catalog.balance.run;
    return {
      weapons: Math.min(maxWeapons, this.stat('weaponSlots')), heavy: maxHeavyWeapons,
      passives: Math.min(maxPassives, this.stat('passiveSlots')),
    };
  }

  loadout(): { weapons: LoadoutItem[]; heavy: LoadoutItem[]; passives: LoadoutItem[] } {
    const weapons: LoadoutItem[] = [];
    const heavy: LoadoutItem[] = [];
    for (const [id, state] of this.weapons) {
      const weapon = this.catalog.weapons[id]!;
      const details = [weapon.description, `Уровень ${state.level}/${weapon.levels.length}`,
        ...levelStats(weapon.levels[state.level - 1]!)];
      if (weapon.evolution) {
        const { passive, into } = weapon.evolution;
        details.push(`Эволюция: ${this.catalog.weapons[into]!.name}, нужен перк «${
          this.catalog.passives[passive]!.name}»`);
      }
      (weapon.heavy ? heavy : weapons).push({
        sprite: weapon.sprite, name: weapon.name, details, level: state.level, max: weapon.levels.length,
      });
    }
    const passives = [...this.ownedPassives].map(([id, level]) => {
      const passive = this.catalog.passives[id]!;
      return {
        sprite: passive.sprite, name: passive.name, level, max: passive.maxLevel,
        details: [passive.description, `Уровень ${level}/${passive.maxLevel}`,
          `Сейчас: ${statBonus(passive.stat, passive.perLevel * level, passive.mod)}`],
      };
    });
    return { weapons, heavy, passives };
  }

  private evolutionChoices(): UpgradeChoice[] {
    const { weapons, passives } = this.catalog;
    return availableEvolutions(weapons, this.weapons, this.ownedPassives).map((option) => {
      const target = weapons[option.into]!;
      return { kind: 'evolution', id: target.id, name: target.name, sprite: target.sprite,
        description: `${weapons[option.from]!.name} + ${passives[option.passive]!.name}`, pairs: [] };
    });
  }

  /** Three cards; a ready evolution comes first and one card is a weapon while any is left. */
  private rollChoices(): UpgradeChoice[] {
    const pool = this.upgradePool(false);
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const chosen = Math.floor(this.rng.next() * (index + 1));
      [pool[index], pool[chosen]] = [pool[chosen]!, pool[index]!];
    }
    const ready = this.evolutionChoices().slice(0, 1);
    const cards = [...ready, ...pool].slice(0, 3);
    if (!cards.some((card) => card.kind !== 'passive')) {
      const weapon = pool.find((card) => card.kind === 'weapon');
      if (weapon) cards[cards.length - 1] = weapon;
    }
    return cards;
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

  /** Replaces the three cards; returns false when no rerolls are left. */
  reroll(): boolean {
    if (this.view.rerolls <= 0 || !this.choices.length) return false;
    this.view.rerolls -= 1;
    this.choices = this.rollChoices();
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
      this.record.evolved = true;
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
    this.record.weapons = Math.max(this.record.weapons, this.weapons.size);
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
    // Explicit data: Phaser would reuse the last restart's otherwise.
    this.scene.launch('Chest', { instant: false });
    this.scene.bringToTop('Chest');
    this.scene.pause();
  }

  // --- damage, death, end ------------------------------------------------------------

  private takeDamage(damage: number, ignoreCooldown = false): boolean {
    if (this.finished) return false;
    const { contactCooldownMs, maxDodge } = this.catalog.balance.run;
    if (!ignoreCooldown && this.elapsedMs - this.lastDamageAt < contactCooldownMs) return false;
    this.lastDamageAt = this.elapsedMs;
    const dodge = Math.min(maxDodge, this.stat('dodge'));
    if (dodge > 0 && this.rng.next() < dodge) {
      this.label('МИМО', COLORS.dim);
      return false;
    }
    this.hurt(Math.max(1, damage - this.stat('armor')));
    return true;
  }

  private hurt(damage: number): void {
    if (this.finished || this.elapsedMs < this.invulnerableUntil) return;
    this.record.damaged = true;
    playSfx('sfx/hero_hurt');
    this.view.hp = Math.max(0, this.view.hp - damage);
    if (this.view.hp > 0) this.record.lowestHp = Math.min(this.record.lowestHp, this.view.hp);
    this.cameras.main.shake(80, 0.005);
    this.hero.setTint(0xff7777);
    this.time.delayedCall(100, () => this.hero.clearTint());
    if (this.view.hp <= 0) this.die();
  }

  private revive(): void {
    const run = this.catalog.balance.run;
    this.view.revives -= 1;
    this.view.hp = this.view.maxHp * run.reviveHpFraction;
    this.invulnerableUntil = this.elapsedMs + run.reviveInvulnerableMs;
    playSfx('sfx/revive');
    this.cameras.main.flash(260, 155, 255, 110);
    this.label('ДЕФИБРИЛЛЯТОР!', COLORS.warn);
    this.playEffect('fx/explosion', 'burst', this.hero.x, this.hero.y, false);
    this.tweens.add({ targets: this.hero, alpha: 0.3, duration: 120, yoyo: true,
      repeat: Math.floor(run.reviveInvulnerableMs / 240), onComplete: () => this.hero.setAlpha(1) });
    this.damageInRadius(this.hero, run.reviveBlastRadius, run.reviveBlastDamage);
  }

  private die(): void {
    if (this.finished) return;
    if (this.view.revives > 0) {
      this.revive();
      return;
    }
    this.finished = true;
    this.physics.pause();
    this.hero.setVelocity(0, 0);
    playSfx('sfx/hero_death');
    const death = animationKey(this.heroDefinition.sprite, 'death');
    if (this.anims.exists(death)) this.hero.anims.play(death);
    this.time.delayedCall(HERO_DEATH_DELAY_MS, () => this.finish('death'));
  }

  /** Leaves the run from the pause menu; what was earned so far is kept. */
  abandon(): void {
    if (this.finished) return;
    this.finish('quit');
  }

  private finish(reason: ResultData['reason']): void {
    this.finished = true;
    this.record.seconds = this.view.seconds;
    this.record.kills = this.view.kills;
    this.record.end = reason;
    this.checkAchievements();
    this.hero.setVelocity(0, 0);
    this.scene.stop('Hud');
    void keepAwake(false);
    const result: ResultData = {
      reason, seconds: this.view.seconds, kills: this.view.kills,
      level: this.view.level, seed: this.view.seed, runId: this.runId,
      bossKilled: this.bossKilled, locationId: this.location.id,
      summary: {
        content_hash: this.contentHash,
        duration_seconds: this.view.seconds,
        kills_by_type: { ...this.killsByType },
        wave_reached: this.view.wave,
        boss_killed: this.bossKilled,
        picked_caps: this.view.caps,
        autopilot: this.record.autopilotMs > 0,
        achievements: this.record.autopilotMs > 0
          ? [...this.reported].filter((id) => {
            const { condition } = this.catalog.achievements[id]!;
            return condition.type === 'reported' && condition.autopilot;
          }) : [...this.reported],
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

  private playEffect(sprite: string, animation: string, x: number, y: number, flipX: boolean, scale = 1): void {
    const key = animationKey(sprite, animation);
    if (!this.anims.exists(key)) return;
    const effect = this.effects.getFirstDead(false) as Phaser.GameObjects.Sprite | null;
    if (!effect) return;
    effect.setActive(true).setVisible(true).setPosition(x, y).setScale(scale).setFlipX(flipX).play(key);
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

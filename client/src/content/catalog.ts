import { enemyBehaviors, pickupEffects, weaponBehaviors } from '../behaviors/registry';
import {
  BalanceSchema, EnemySchema, HeroSchema, LandmarkSchema, LocationSchema, PassiveSchema, PickupSchema,
  StructureSchema, UpgradeSchema, WeaponSchema,
} from './schemas';
import type {
  BalanceDefinition, EnemyDefinition, HeroDefinition, LandmarkDefinition, LocationDefinition,
  PassiveDefinition, PickupDefinition, StructureDefinition, UpgradeDefinition, WeaponDefinition,
} from './schemas';

export interface Catalog {
  balance: BalanceDefinition;
  heroes: Record<string, HeroDefinition>;
  weapons: Record<string, WeaponDefinition>;
  passives: Record<string, PassiveDefinition>;
  enemies: Record<string, EnemyDefinition>;
  locations: Record<string, LocationDefinition>;
  upgrades: Record<string, UpgradeDefinition>;
  pickups: Record<string, PickupDefinition>;
  landmarks: Record<string, LandmarkDefinition>;
  structures: Record<string, StructureDefinition>;
}

const bundledFiles = import.meta.glob<unknown>('../../../content/**/*.json', {
  eager: true,
  import: 'default',
});

export function validateContent(files: Record<string, unknown>): Catalog {
  const seen = new Set<string>();
  const heroes: Catalog['heroes'] = {};
  const weapons: Catalog['weapons'] = {};
  const passives: Catalog['passives'] = {};
  const enemies: Catalog['enemies'] = {};
  const locations: Catalog['locations'] = {};
  const upgrades: Catalog['upgrades'] = {};
  const pickups: Catalog['pickups'] = {};
  const landmarks: Catalog['landmarks'] = {};
  const structures: Catalog['structures'] = {};
  let balance: BalanceDefinition | undefined;

  function add<T extends { id: string }>(target: Record<string, T>, value: T, path: string): void {
    if (seen.has(value.id)) throw new Error(`${path}: duplicate id ${value.id}`);
    seen.add(value.id);
    target[value.id] = value;
  }

  for (const [path, raw] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (path.endsWith('/balance.json')) {
      if (balance) throw new Error(`${path}: duplicate balance.json`);
      balance = BalanceSchema.parse(raw);
      continue;
    }
    const category = path.split('/').at(-2);
    switch (category) {
      case 'heroes': add(heroes, HeroSchema.parse(raw), path); break;
      case 'weapons': add(weapons, WeaponSchema.parse(raw), path); break;
      case 'passives': add(passives, PassiveSchema.parse(raw), path); break;
      case 'enemies': add(enemies, EnemySchema.parse(raw), path); break;
      case 'locations': add(locations, LocationSchema.parse(raw), path); break;
      case 'upgrades': add(upgrades, UpgradeSchema.parse(raw), path); break;
      case 'pickups': add(pickups, PickupSchema.parse(raw), path); break;
      case 'landmarks': add(landmarks, LandmarkSchema.parse(raw), path); break;
      case 'structures': add(structures, StructureSchema.parse(raw), path); break;
      default: throw new Error(`${path}: unknown content category`);
    }
  }

  if (!balance) throw new Error('content/balance.json is missing');
  if (!Object.keys(heroes).length || !Object.keys(weapons).length
    || !Object.keys(enemies).length || !Object.keys(locations).length) {
    throw new Error('Catalog needs a hero, weapon, enemy and location');
  }

  for (const hero of Object.values(heroes)) {
    if (!weapons[hero.startingWeapon]) {
      throw new Error(`hero ${hero.id}: unknown starting weapon ${hero.startingWeapon}`);
    }
  }
  for (const weapon of Object.values(weapons)) {
    const behavior = weaponBehaviors[weapon.behavior.type];
    if (!behavior) throw new Error(`weapon ${weapon.id}: unknown behavior ${weapon.behavior.type}`);
    behavior.paramsSchema.parse(weapon.behavior.params);
    weapon.levels.forEach((level, index) => {
      for (const field of behavior.requiredLevelFields) {
        if (level[field] === undefined) {
          throw new Error(`weapon ${weapon.id}: level ${index + 1} needs ${field}`);
        }
      }
    });
  }
  const evolutionTargets = new Set<string>();
  for (const weapon of Object.values(weapons)) {
    if (!weapon.evolution) continue;
    const { passive, into } = weapon.evolution;
    if (!passives[passive]) throw new Error(`weapon ${weapon.id}: unknown evolution passive ${passive}`);
    if (!weapons[into]?.evolved) {
      throw new Error(`weapon ${weapon.id}: evolution target ${into} must be an evolved weapon`);
    }
    if (evolutionTargets.has(into)) throw new Error(`weapon ${into}: more than one evolution source`);
    evolutionTargets.add(into);
  }
  for (const weapon of Object.values(weapons)) {
    if (weapon.evolved && !evolutionTargets.has(weapon.id)) {
      throw new Error(`weapon ${weapon.id}: evolved weapon has no evolution source`);
    }
  }
  for (const hero of Object.values(heroes)) {
    if (weapons[hero.startingWeapon]!.evolved) {
      throw new Error(`hero ${hero.id}: starting weapon cannot be evolved`);
    }
  }
  for (const pickup of Object.values(pickups)) {
    const effect = pickupEffects[pickup.effect.type];
    if (!effect) throw new Error(`pickup ${pickup.id}: unknown effect ${pickup.effect.type}`);
    effect.paramsSchema.parse(pickup.effect.params);
  }
  for (const landmark of Object.values(landmarks)) {
    for (const reward of landmark.rewards) {
      if (!pickups[reward.pickup]) {
        throw new Error(`landmark ${landmark.id}: unknown reward ${reward.pickup}`);
      }
    }
  }
  for (const structure of Object.values(structures)) {
    for (const item of structure.items) {
      if (item.kind === 'landmark' && !landmarks[item.landmark]) {
        throw new Error(`structure ${structure.id}: unknown landmark ${item.landmark}`);
      }
    }
  }
  const needEnemy = (owner: string, id: string, role?: EnemyDefinition['role']): void => {
    const enemy = enemies[id];
    if (!enemy) throw new Error(`${owner}: unknown enemy ${id}`);
    if (role && enemy.role !== role) throw new Error(`${owner}: enemy ${id} must have role ${role}`);
  };
  for (const enemy of Object.values(enemies)) {
    const behavior = enemyBehaviors[enemy.ai.type];
    if (!behavior) throw new Error(`enemy ${enemy.id}: unknown AI ${enemy.ai.type}`);
    behavior.validate?.(behavior.paramsSchema.parse(enemy.ai.params));
    for (const drop of enemy.drops) {
      if (drop.item === 'pickup' && !pickups[drop.id]) {
        throw new Error(`enemy ${enemy.id}: unknown drop pickup ${drop.id}`);
      }
    }
    if (enemy.split) {
      needEnemy(`enemy ${enemy.id} split`, enemy.split.enemy, 'normal');
      if (enemies[enemy.split.enemy]?.split) {
        throw new Error(`enemy ${enemy.id}: split pieces cannot split again`);
      }
    }
    if (enemy.ai.type === 'boss_phases') {
      const params = enemy.ai.params as { phases: { summon?: { enemy: string } }[] };
      for (const phase of params.phases) {
        if (phase.summon) needEnemy(`enemy ${enemy.id}`, phase.summon.enemy, 'normal');
      }
    }
  }
  if (!pickups.cap) throw new Error('content/pickups/cap.json is required for caps drops');
  if (!Object.values(locations).some((location) => location.unlock.type === 'default')) {
    throw new Error('At least one location must be open from the start');
  }
  for (const location of Object.values(locations)) {
    if (!heroes[location.startingHero]) {
      throw new Error(`location ${location.id}: unknown hero ${location.startingHero}`);
    }
    if (location.unlock.type === 'bossKilled' && !locations[location.unlock.location]) {
      throw new Error(`location ${location.id}: unlocks after unknown location`);
    }
    if (location.waves[0]?.atSecond !== 0) {
      throw new Error(`location ${location.id}: first wave must start at second 0`);
    }
    let previous = -1;
    for (const wave of location.waves) {
      if (wave.atSecond <= previous || wave.atSecond >= location.durationSeconds) {
        throw new Error(`location ${location.id}: invalid wave time ${wave.atSecond}`);
      }
      previous = wave.atSecond;
      for (const entry of wave.enemies) {
        if (!enemies[entry.id]) {
          throw new Error(`location ${location.id}: unknown wave enemy ${entry.id}`);
        }
        needEnemy(`location ${location.id} wave`, entry.id, 'normal');
      }
    }
    for (const event of location.events) {
      needEnemy(`location ${location.id} event`, event.enemy, 'elite');
      if (event.atSecond >= location.durationSeconds) {
        throw new Error(`location ${location.id}: event after the end at ${event.atSecond}`);
      }
    }
    needEnemy(`location ${location.id} boss`, location.boss.enemy, 'boss');
    if (location.boss.atSecond >= location.durationSeconds) {
      throw new Error(`location ${location.id}: boss must appear before the end`);
    }
    for (const item of location.decor.structures.items) {
      if (!structures[item.structure]) {
        throw new Error(`location ${location.id}: unknown structure ${item.structure}`);
      }
    }
    const structureItems = location.decor.structures.items
      .flatMap((item) => structures[item.structure]!.items);
    const patches = new Set<string>();
    for (const biome of location.decor.biomes) {
      for (const item of biome.patches.items) patches.add(item.sprite);
    }
    for (const item of structureItems) if (item.kind === 'patch') patches.add(item.sprite);
    for (const hazard of location.decor.hazards) {
      if (!patches.has(hazard.sprite)) {
        throw new Error(`location ${location.id}: hazard ${hazard.sprite} is never placed`);
      }
    }
    for (const drop of location.decor.crates.drops) {
      if (!pickups[drop.pickup]) {
        throw new Error(`location ${location.id}: unknown crate pickup ${drop.pickup}`);
      }
    }
  }

  return { balance, heroes, weapons, passives, enemies, locations, upgrades, pickups, landmarks, structures };
}

let cached: Catalog | undefined;

export function getCatalog(): Catalog {
  cached ??= validateContent(bundledFiles);
  return cached;
}

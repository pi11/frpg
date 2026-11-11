import { enemyBehaviors, weaponBehaviors } from '../behaviors/registry';
import {
  BalanceSchema, EnemySchema, HeroSchema, LocationSchema, PassiveSchema, UpgradeSchema,
  WeaponSchema,
} from './schemas';
import type {
  BalanceDefinition, EnemyDefinition, HeroDefinition, LocationDefinition,
  PassiveDefinition, UpgradeDefinition, WeaponDefinition,
} from './schemas';

export interface Catalog {
  balance: BalanceDefinition;
  heroes: Record<string, HeroDefinition>;
  weapons: Record<string, WeaponDefinition>;
  passives: Record<string, PassiveDefinition>;
  enemies: Record<string, EnemyDefinition>;
  locations: Record<string, LocationDefinition>;
  upgrades: Record<string, UpgradeDefinition>;
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
    const behavior = weaponBehaviors[weapon.behavior.type as keyof typeof weaponBehaviors];
    if (!behavior) throw new Error(`weapon ${weapon.id}: unknown behavior ${weapon.behavior.type}`);
    behavior.paramsSchema.parse(weapon.behavior.params);
  }
  for (const enemy of Object.values(enemies)) {
    const behavior = enemyBehaviors[enemy.ai.type as keyof typeof enemyBehaviors];
    if (!behavior) throw new Error(`enemy ${enemy.id}: unknown AI ${enemy.ai.type}`);
    behavior.paramsSchema.parse(enemy.ai.params);
  }
  for (const location of Object.values(locations)) {
    if (!heroes[location.startingHero]) {
      throw new Error(`location ${location.id}: unknown hero ${location.startingHero}`);
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
      }
    }
  }

  return { balance, heroes, weapons, passives, enemies, locations, upgrades };
}

let cached: Catalog | undefined;

export function getCatalog(): Catalog {
  cached ??= validateContent(bundledFiles);
  return cached;
}

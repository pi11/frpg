import { describe, expect, it } from 'vitest';
import { getCatalog, validateContent } from './catalog';
import { orderedLocations } from './locations';

const rawFiles = import.meta.glob<unknown>('../../../content/**/*.json', {
  eager: true, import: 'default',
});

describe('shared content catalog', () => {
  it('validates every JSON file and all references', () => {
    const content = getCatalog();
    expect(Object.keys(content.heroes)).toContain('wanderer');
    expect(Object.keys(content.weapons)).toContain('scattergun');
    expect(Object.keys(content.enemies)).toContain('roach');
    expect(content.locations.shelter_outskirts?.waves.length).toBeGreaterThan(0);
  });

  it('rejects a wave that references a missing enemy', () => {
    const locationPath = Object.keys(rawFiles).find((path) => path.endsWith('shelter_outskirts.json'));
    expect(locationPath).toBeDefined();
    const location = structuredClone(rawFiles[locationPath!] as { waves: { enemies: { id: string }[] }[] });
    location.waves[0]!.enemies[0]!.id = 'missing_enemy';
    expect(() => validateContent({ ...rawFiles, [locationPath!]: location }))
      .toThrow('unknown wave enemy');
  });

  it('rejects an unregistered weapon behavior', () => {
    const weaponPath = Object.keys(rawFiles).find((path) => path.endsWith('scattergun.json'));
    expect(weaponPath).toBeDefined();
    const weapon = structuredClone(rawFiles[weaponPath!] as { behavior: { type: string } });
    weapon.behavior.type = 'unregistered';
    expect(() => validateContent({ ...rawFiles, [weaponPath!]: weapon }))
      .toThrow('unknown behavior');
  });

  it('rejects a wave enemy that is an elite', () => {
    const locationPath = Object.keys(rawFiles).find((path) => path.endsWith('shelter_outskirts.json'));
    const location = structuredClone(rawFiles[locationPath!] as { waves: { enemies: { id: string }[] }[] });
    location.waves[0]!.enemies[0]!.id = 'brute';
    expect(() => validateContent({ ...rawFiles, [locationPath!]: location })).toThrow('role normal');
  });

  it('rejects a weapon level without the fields its behavior needs', () => {
    const weaponPath = Object.keys(rawFiles).find((path) => path.endsWith('orbit_drone.json'));
    const weapon = structuredClone(rawFiles[weaponPath!] as { levels: { radius?: number }[] });
    delete weapon.levels[3]!.radius;
    expect(() => validateContent({ ...rawFiles, [weaponPath!]: weapon })).toThrow('level 4 needs radius');
  });

  it('rejects broken weapon evolutions', () => {
    const find = (name: string): string => Object.keys(rawFiles).find((path) => path.endsWith(name))!;
    type Path = { passive: string; into: string };
    type Raw = { evolutions?: Path[]; evolved?: boolean; levels: unknown[] };
    const pistolPath = find('scrap_pistol.json');
    const pistol = structuredClone(rawFiles[pistolPath] as Raw);
    pistol.evolutions![1]!.passive = 'missing_perk';
    expect(() => validateContent({ ...rawFiles, [pistolPath]: pistol })).toThrow('unknown evolution passive');
    pistol.evolutions![1] = { passive: 'nimble', into: 'scattergun' };
    expect(() => validateContent({ ...rawFiles, [pistolPath]: pistol })).toThrow('must be an evolved weapon');
    pistol.evolutions![1] = { passive: 'nimble', into: 'scrap_cannon' };
    expect(() => validateContent({ ...rawFiles, [pistolPath]: pistol })).toThrow('more than one evolution source');

    const nailPath = find('nail_gun.json');
    const nailGun = structuredClone(rawFiles[nailPath] as Raw);
    nailGun.levels.push(nailGun.levels[0]);
    expect(() => validateContent({ ...rawFiles, [nailPath]: nailGun })).toThrow('evolved weapon needs 1 level');
    const orphan = { ...pistol, evolutions: [] };
    expect(() => validateContent({ ...rawFiles, [pistolPath]: orphan })).toThrow('has no evolution source');
  });

  it('gives every evolved weapon its own projectile and a clear power gain', () => {
    const { weapons } = getCatalog();
    for (const base of Object.values(weapons)) {
      for (const { into } of base.evolutions) {
        const evolved = weapons[into]!;
        expect(evolved.projectileSprite, into).not.toBe(base.projectileSprite);
        const power = (level: { damage: number; shots: number; cooldownMs: number }): number =>
          level.damage * level.shots / level.cooldownMs;
        expect(power(evolved.levels[0]!) / power(base.levels.at(-1)!), into).toBeGreaterThan(1.4);
      }
    }
  });

  it('opens heavy weapon slots only for emeralds', () => {
    const { heroes, upgrades, balance } = getCatalog();
    for (const hero of Object.values(heroes)) expect(hero.baseStats.heavySlots, hero.id).toBe(0);
    const slots = Object.values(upgrades).filter((upgrade) => upgrade.stat === 'heavySlots');
    expect(slots.length).toBeGreaterThan(0);
    for (const upgrade of slots) expect(upgrade.currency).toBe('emeralds');
    expect(slots.reduce((sum, upgrade) => sum + upgrade.perLevel * upgrade.maxLevel, 0))
      .toBe(balance.run.maxHeavyWeapons);
  });

  it('rejects a heavy weapon with evolutions or a starting weapon sold for emeralds', () => {
    const find = (name: string): string => Object.keys(rawFiles).find((path) => path.endsWith(name))!;
    const railPath = find('rail_gun.json');
    const rail = structuredClone(rawFiles[railPath] as { levels: unknown[]; evolutions?: unknown });
    rail.evolutions = [{ passive: 'scope', into: 'nail_gun' }];
    expect(() => validateContent({ ...rawFiles, [railPath]: rail })).toThrow('cannot evolve');
    delete rail.evolutions;
    rail.levels.pop();
    expect(() => validateContent({ ...rawFiles, [railPath]: rail })).toThrow('heavy weapon needs 5 level');
    const pistolPath = find('scrap_pistol.json');
    const pistol = structuredClone(rawFiles[pistolPath] as { unlock?: unknown });
    pistol.unlock = { type: 'emeralds', emeralds: 5 };
    expect(() => validateContent({ ...rawFiles, [pistolPath]: pistol })).toThrow('cannot cost emeralds');
  });

  it('has clearly bigger and tougher mini-bosses than ordinary enemies', () => {
    const enemies = Object.values(getCatalog().enemies);
    const toughest = Math.max(...enemies.filter((item) => item.role === 'normal').map((item) => item.stats.hp));
    for (const elite of enemies.filter((item) => item.role === 'elite')) {
      expect(elite.stats.hp, elite.id).toBeGreaterThan(toughest * 20);
    }
  });

  it('rejects a boss achievement without its location', () => {
    const path = Object.keys(rawFiles).find((key) => key.endsWith('junk_king_down.json'))!;
    const raw = structuredClone(rawFiles[path] as { condition: { location: string } });
    raw.condition.location = 'moon_base';
    expect(() => validateContent({ ...rawFiles, [path]: raw })).toThrow('unknown location moon_base');
  });

  it('rejects a hero that nothing can unlock', () => {
    const path = Object.keys(rawFiles).find((key) => key.endsWith('heroes/marksman.json'))!;
    const raw = structuredClone(rawFiles[path] as { unlock: { location: string; atSecond: number } });
    raw.unlock.atSecond = 999;
    expect(() => validateContent({ ...rawFiles, [path]: raw })).toThrow('no milestone at 999');
    raw.unlock.location = 'moon_base';
    expect(() => validateContent({ ...rawFiles, [path]: raw })).toThrow('unknown unlock location');
  });

  it('rejects broken daily quest templates', () => {
    const path = Object.keys(rawFiles).find((key) => key.endsWith('daily/kill_ghouls.json'))!;
    const raw = structuredClone(rawFiles[path] as { enemy: string; emeralds: number[] });
    raw.enemy = 'brute';
    expect(() => validateContent({ ...rawFiles, [path]: raw })).toThrow('unknown ordinary enemy');
    raw.enemy = 'ghoul';
    raw.emeralds.pop();
    expect(() => validateContent({ ...rawFiles, [path]: raw })).toThrow('same length');
  });

  it('rejects a boss phase with an unknown AI', () => {
    const bossPath = Object.keys(rawFiles).find((path) => path.endsWith('junk_king.json'));
    const boss = structuredClone(rawFiles[bossPath!] as { ai: { params: { phases: { ai: { type: string } }[] } } });
    boss.ai.params.phases[1]!.ai.type = 'teleporter';
    expect(() => validateContent({ ...rawFiles, [bossPath!]: boss })).toThrow('unknown boss phase AI');
  });

  it('rejects a drop of an unknown pickup', () => {
    const enemyPath = Object.keys(rawFiles).find((path) => path.endsWith('brute.json'));
    const enemy = structuredClone(rawFiles[enemyPath!] as { drops: { id?: string }[] });
    enemy.drops[0]!.id = 'golden_gun';
    expect(() => validateContent({ ...rawFiles, [enemyPath!]: enemy })).toThrow('unknown drop pickup');
  });

  it('checks landmark choices: a free careful card, a risky fight first, a paid instant buy', () => {
    const path = Object.keys(rawFiles).find((item) => item.endsWith('landmarks/generator.json'))!;
    type Choice = { id: string; caps: number; holdMs: number; guaranteed?: string[]; ambush?: { when: string } };
    const edit = (change: (choices: Choice[]) => void): (() => unknown) => {
      const landmark = structuredClone(rawFiles[path] as { choices: Choice[] });
      change(landmark.choices);
      return () => validateContent({ ...rawFiles, [path]: landmark });
    };
    expect(edit(() => undefined)).not.toThrow();
    expect(edit((choices) => { choices[0]!.caps = 5; })).toThrow('free careful choice');
    expect(edit((choices) => { choices[1]!.ambush!.when = 'complete'; })).toThrow('ambush right after');
    expect(edit((choices) => { choices[2]!.holdMs = 1000; })).toThrow('pays at once');
    expect(edit((choices) => { choices[1]!.guaranteed = ['golden_gun']; })).toThrow('unknown pickup');
    expect(edit((choices) => { choices[2]!.id = 'risky'; })).toThrow('duplicate choice');
  });

  it('rejects duplicate content ids', () => {
    const enemyPath = Object.keys(rawFiles).find((path) => path.endsWith('ghoul.json'));
    expect(enemyPath).toBeDefined();
    expect(() => validateContent({
      ...rawFiles,
      '../../../content/enemies/duplicate.json': rawFiles[enemyPath!],
    })).toThrow('duplicate id');
  });
});

describe('assets referenced by content', () => {
  it('exist in the atlas, ground images and audio folders and are licensed', async () => {
    const { existsSync, readdirSync, readFileSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const { HUB_MUSIC, UI_SOUNDS } = await import('../assets');
    const assets = join(process.cwd(), 'public', 'assets');
    const atlas = JSON.parse(readFileSync(join(assets, 'atlas', 'sprites.json'), 'utf8')) as {
      frames: Record<string, unknown>;
    };
    const frames = new Set(Object.keys(atlas.frames));
    const missing: string[] = [];
    const needFrame = (frame: string): void => { if (!frames.has(frame)) missing.push(`frame ${frame}`); };
    const needFile = (path: string): void => { if (!existsSync(join(assets, path))) missing.push(`file ${path}`); };
    const content = getCatalog();
    for (const actor of [...Object.values(content.heroes), ...Object.values(content.enemies)]) {
      needFrame(actor.sprite);
      needFrame(`${actor.sprite}/walk_0`);
      needFrame(`${actor.sprite}/death_0`);
    }
    for (const hero of Object.values(content.heroes)) needFrame(`${hero.sprite}/idle_0`);
    needFile('ui/shelter.png');
    for (const weapon of Object.values(content.weapons)) {
      needFrame(weapon.sprite);
      needFrame(weapon.projectileSprite);
      needFile(`${weapon.fireSound}.wav`);
    }
    for (const passive of Object.values(content.passives)) needFrame(passive.sprite);
    for (const pickup of Object.values(content.pickups)) {
      needFrame(pickup.sprite);
      needFile(`${pickup.sound}.wav`);
    }
    for (const location of Object.values(content.locations)) {
      needFile(`${location.groundSprite}.png`);
      for (const music of [location.music, location.bossMusic]) {
        needFile(`${music}.ogg`);
        needFile(`${music}.mp3`);
      }
      const { decor } = location;
      for (const biome of decor.biomes) {
        for (const item of [...biome.patches.items, ...biome.objects.items]) needFrame(item.sprite);
      }
      needFrame(decor.crates.sprite);
      needFrame(`${decor.crates.sprite}/break_0`);
    }
    for (const weapon of Object.values(content.weapons)) {
      if (weapon.behavior.type === 'orbit') needFrame(`${weapon.projectileSprite}/spin_0`);
      if (weapon.behavior.type === 'turret') {
        needFrame(`${weapon.projectileSprite}/spin_0`);
        needFrame((weapon.behavior.params as { shotSprite: string }).shotSprite);
      }
      const fire = (weapon.behavior.params as { fireSprite?: string }).fireSprite;
      if (fire) needFrame(`${fire}/burn_0`);
    }
    for (const landmark of Object.values(content.landmarks)) {
      needFrame(landmark.sprite);
      needFrame(`${landmark.sprite}_used`);
    }
    for (const structure of Object.values(content.structures)) {
      for (const item of structure.items) {
        if (item.kind === 'patch' || item.kind === 'object') needFrame(item.sprite);
      }
    }
    for (const boost of Object.values(content.boosts)) needFrame(boost.sprite);
    // Enemy shots, also inside boss phases.
    const shots = (ai: { type: string; params: unknown }): string[] => ai.type === 'boss_phases'
      ? (ai.params as { phases: { ai: { type: string; params: unknown } }[] }).phases.flatMap((phase) => shots(phase.ai))
      : [(ai.params as { projectileSprite?: string }).projectileSprite ?? ''].filter(Boolean);
    for (const enemy of Object.values(content.enemies)) for (const sprite of shots(enemy.ai)) needFrame(sprite);
    for (const frame of ['xp/green', 'xp/green/idle_0', 'ui/cap', 'ui/emerald', 'fx/ray/idle_0', 'fx/hit/burst_0',
      'fx/explosion/burst_0']) needFrame(frame);
    for (const sound of UI_SOUNDS) needFile(`${sound}.wav`);
    needFile(`${HUB_MUSIC}.ogg`);
    needFile(`${HUB_MUSIC}.mp3`);
    expect(missing).toEqual([]);

    const credits = readFileSync(join(assets, 'CREDITS.md'), 'utf8');
    const unlicensed: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { walk(path); continue; }
        const file = relative(assets, path);
        if (file === 'CREDITS.md') continue;
        const folder = file.includes('/') ? `${file.slice(0, file.lastIndexOf('/'))}/*` : file;
        if (!credits.includes(`\`${file}\``) && !credits.includes(`\`${folder}\``)) unlicensed.push(file);
      }
    };
    walk(assets);
    expect(unlicensed).toEqual([]);
  });
});

describe('landmarks and structures', () => {
  const changed = (name: string, edit: (raw: never) => void): Record<string, unknown> => {
    const path = Object.keys(rawFiles).find((key) => key.endsWith(name))!;
    const copy = structuredClone(rawFiles[path]);
    edit(copy as never);
    return { ...rawFiles, [path]: copy };
  };

  it('reject unknown rewards, landmarks and structures', () => {
    expect(() => validateContent(changed('landmarks/vending.json',
      (raw: { rewards: { pickup: string }[] }) => { raw.rewards[0]!.pickup = 'gold'; })))
      .toThrow('unknown reward');
    expect(() => validateContent(changed('structures/radio_post.json',
      (raw: { items: { landmark?: string }[] }) => { raw.items.at(-1)!.landmark = 'castle'; })))
      .toThrow('unknown landmark');
    expect(() => validateContent(changed('locations/dead_city.json',
      (raw: { decor: { structures: { items: { structure: string }[] } } }) => {
        raw.decor.structures.items[0]!.structure = 'castle';
      }))).toThrow('unknown structure');
  });

  it('reject a hazard that is never placed', () => {
    expect(() => validateContent(changed('locations/dead_city.json',
      (raw: { decor: { hazards: { sprite: string }[] } }) => {
        raw.decor.hazards[0]!.sprite = 'decor/toxic_pool';
      }))).toThrow('never placed');
  });

  it('every location has places with rewards and at least three biomes', () => {
    const { locations, structures } = getCatalog();
    for (const location of Object.values(locations)) {
      expect(location.decor.biomes.length).toBeGreaterThanOrEqual(3);
      expect(location.decor.structures.items.some((item) =>
        structures[item.structure]!.items.some((part) => part.kind === 'landmark'))).toBe(true);
    }
  });
});

describe('locations', () => {
  it('are listed in unlock order and each later one needs the previous boss', () => {
    const ordered = orderedLocations(getCatalog());
    expect(ordered.map((location) => location.id))
      .toEqual(['shelter_outskirts', 'dead_city', 'toxic_marsh', 'military_base', 'dark_forest', 'dungeon',
        'frozen_pass', 'great_desert']);
    ordered.slice(1).forEach((location, index) => {
      expect(location.unlock).toEqual({ type: 'bossKilled', location: ordered[index]!.id });
      expect(location.rewardMultiplier).toBeGreaterThan(ordered[index]!.rewardMultiplier);
    });
  });

  it('rejects an unlock that points to an unknown location', () => {
    const cityPath = Object.keys(rawFiles).find((path) => path.endsWith('dead_city.json'))!;
    const city = structuredClone(rawFiles[cityPath] as { unlock: { location: string } });
    city.unlock.location = 'moon_base';
    expect(() => validateContent({ ...rawFiles, [cityPath]: city })).toThrow('unlocks after unknown location');
  });

  it('rejects a split into a non-normal enemy', () => {
    const slimePath = Object.keys(rawFiles).find((path) => path.endsWith('glow_slime.json'))!;
    const slime = structuredClone(rawFiles[slimePath] as { split: { enemy: string } });
    slime.split.enemy = 'brute';
    expect(() => validateContent({ ...rawFiles, [slimePath]: slime })).toThrow('role normal');
  });
});

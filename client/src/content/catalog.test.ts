import { describe, expect, it } from 'vitest';
import { getCatalog, validateContent } from './catalog';

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
    type Raw = { evolution?: { passive: string; into: string }; evolved?: boolean; levels: unknown[] };
    const pistolPath = find('scrap_pistol.json');
    const pistol = structuredClone(rawFiles[pistolPath] as Raw);
    pistol.evolution!.passive = 'missing_perk';
    expect(() => validateContent({ ...rawFiles, [pistolPath]: pistol })).toThrow('unknown evolution passive');
    pistol.evolution = { passive: 'trigger_spring', into: 'scattergun' };
    expect(() => validateContent({ ...rawFiles, [pistolPath]: pistol })).toThrow('must be an evolved weapon');

    const nailPath = find('nail_gun.json');
    const nailGun = structuredClone(rawFiles[nailPath] as Raw);
    nailGun.levels.push(nailGun.levels[0]);
    expect(() => validateContent({ ...rawFiles, [nailPath]: nailGun })).toThrow('evolved weapon needs 1 level');
    const orphan = { ...pistol, evolution: undefined };
    delete orphan.evolution;
    expect(() => validateContent({ ...rawFiles, [pistolPath]: orphan })).toThrow('has no evolution source');
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
      for (const item of [...decor.patches.items, ...decor.objects.items]) needFrame(item.sprite);
      needFrame(decor.crates.sprite);
      needFrame(`${decor.crates.sprite}/break_0`);
    }
    for (const weapon of Object.values(content.weapons)) {
      if (weapon.behavior.type === 'orbit') needFrame(`${weapon.projectileSprite}/spin_0`);
      const fire = (weapon.behavior.params as { fireSprite?: string }).fireSprite;
      if (fire) needFrame(`${fire}/burn_0`);
    }
    for (const frame of ['xp/green', 'xp/green/idle_0', 'ui/cap', 'fx/hit/burst_0',
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

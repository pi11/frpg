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

  it('rejects duplicate content ids', () => {
    const enemyPath = Object.keys(rawFiles).find((path) => path.endsWith('ghoul.json'));
    expect(enemyPath).toBeDefined();
    expect(() => validateContent({
      ...rawFiles,
      '../../../content/enemies/duplicate.json': rawFiles[enemyPath!],
    })).toThrow('duplicate id');
  });
});

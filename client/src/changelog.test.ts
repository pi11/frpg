import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANGELOG, VERSION } from './changelog';

const parse = (version: string): number[] => version.split('.').map(Number);

describe('changelog', () => {
  it('starts at 0.0.1 and every release raises the version by one step', () => {
    expect(CHANGELOG.at(-1)!.version).toBe('0.0.1');
    for (let index = 0; index < CHANGELOG.length - 1; index += 1) {
      const [major, minor, patch] = parse(CHANGELOG[index]!.version);
      const [oldMajor, oldMinor, oldPatch] = parse(CHANGELOG[index + 1]!.version);
      const nextPatch = major === oldMajor && minor === oldMinor && patch === oldPatch! + 1;
      const nextMinor = major === oldMajor && minor === oldMinor! + 1 && patch === 0;
      const nextMajor = major === oldMajor! + 1 && minor === 0 && patch === 0;
      expect(nextPatch || nextMinor || nextMajor, CHANGELOG[index]!.version).toBe(true);
    }
    for (const release of CHANGELOG) {
      expect(release.date).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
      expect(release.changes.length).toBeGreaterThan(0);
    }
  });

  it('matches client/package.json', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
    expect(pkg.version).toBe(VERSION);
  });
});

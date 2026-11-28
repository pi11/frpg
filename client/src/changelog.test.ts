import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANGELOG, VERSION } from './changelog';

const parse = (version: string): number[] => version.split('.').map(Number);
const newer = (a: string, b: string): boolean => {
  const [x, y] = [parse(a), parse(b)];
  for (let index = 0; index < 3; index += 1) if (x[index] !== y[index]) return x[index]! > y[index]!;
  return false;
};

describe('changelog', () => {
  it('starts at 0.0.1 and lists versions newest first', () => {
    expect(CHANGELOG.at(-1)!.version).toBe('0.0.1');
    for (let index = 0; index < CHANGELOG.length - 1; index += 1) {
      expect(newer(CHANGELOG[index]!.version, CHANGELOG[index + 1]!.version), CHANGELOG[index]!.version).toBe(true);
    }
    for (const release of CHANGELOG) {
      expect(release.date).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
      expect(release.changes.length).toBeGreaterThan(0);
    }
  });

  it('never names a hidden achievement', async () => {
    const { getCatalog } = await import('./content/catalog');
    const hidden = Object.values(getCatalog().achievements).filter((item) => item.hidden).map((item) => item.name);
    const text = CHANGELOG.flatMap((release) => [release.title, ...release.changes]).join('\n');
    expect(hidden.filter((name) => text.toLowerCase().includes(name.toLowerCase()))).toEqual([]);
  });

  it('shows the package.json version, which is not older than the last entry', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
    expect(VERSION === CHANGELOG[0]!.version || newer(VERSION, CHANGELOG[0]!.version)).toBe(true);
  });
});

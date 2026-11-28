import { describe, expect, it } from 'vitest';
import vectors from '../../testdata/economy_vectors.json';
import { bundledContentHash, contentDigest } from './content/hash';
import { getCatalog } from './content/catalog';
import { emeraldReward, runReward, upgradeCost } from './economy';

// The same file is checked by server/tests/test_economy.py.
describe('economy formulas match the server', () => {
  it('prices upgrades like the server', () => {
    for (const item of vectors.upgradeCost) {
      expect(upgradeCost({ cost: item.cost }, item.level), JSON.stringify(item)).toBe(item.expected);
    }
  });

  it('rewards runs like the server', () => {
    for (const item of vectors.runReward) {
      expect(runReward(item.rules, {
        duration: item.duration, kills: item.kills, wave: item.wave,
        bossKilled: item.boss_killed, pickedCaps: item.picked_caps,
        multiplier: item.multiplier,
      }), JSON.stringify(item)).toBe(item.expected);
    }
  });

  it('grants emeralds like the server', () => {
    for (const item of vectors.emeraldReward) {
      expect(emeraldReward(item.rates, item.milestones, {
        elites: item.elites, bossKilled: item.boss_killed, firstBoss: item.first_boss,
        passed: item.passed,
      }), JSON.stringify(item)).toBe(item.expected);
    }
  });

  it('hashes content like the server', async () => {
    for (const item of vectors.contentDigest) {
      const files = Object.fromEntries(
        Object.entries(item.files).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
      expect(await contentDigest(files)).toBe(item.expected);
    }
  });
});

describe('contracts', () => {
  // Same inputs as test_contract_pays_no_more_per_minute_than_the_same_minutes_of_a_full_run.
  it('pay no more per minute than the same minutes of a full run, bonus included', () => {
    const { balance, contracts, locations } = getCatalog();
    for (const contract of Object.values(contracts)) {
      const location = locations[contract.location]!;
      const seconds = contract.durationSeconds;
      const fullWaves = location.waves.filter((wave) => wave.atSecond <= seconds).length;
      for (const perSecond of [0.5, 1, 2, 3, 5]) {
        const kills = Math.floor(seconds * perSecond);
        const short = runReward(balance.reward, {
          duration: seconds, kills, wave: contract.waves.length, bossKilled: false, pickedCaps: 0,
          multiplier: location.rewardMultiplier * contract.rewardMultiplier,
        }) + contract.completionCaps;
        const full = runReward(balance.reward, {
          duration: seconds, kills, wave: fullWaves, bossKilled: false, pickedCaps: 0, multiplier: location.rewardMultiplier,
        });
        expect(short, `${contract.id} at ${perSecond}/s`).toBeLessThanOrEqual(full);
      }
    }
  });
});

describe('bundled content hash', () => {
  it('matches the bytes the server hashes', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const root = join(process.cwd(), '..');
    const files: Record<string, string> = {};
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.json')) files[relative(root, path)] = readFileSync(path, 'utf8');
      }
    };
    walk(join(root, 'content'));
    expect(await bundledContentHash()).toBe(await contentDigest(files));
  });
});

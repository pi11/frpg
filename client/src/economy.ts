import type { BalanceDefinition, UpgradeDefinition } from './content/schemas';

// Mirror of server/app/services/economy.py. The operations and their order must stay
// identical so both sides produce the same integers; testdata/economy_vectors.json is
// checked by tests on both sides. Exponents use repeated multiplication because
// Math.pow and CPython's ** may round the last bit differently.

export type RewardRules = Omit<BalanceDefinition['reward'], 'emeraldMilestones'>;

export interface RewardInput {
  duration: number;
  kills: number;
  wave: number;
  bossKilled: boolean;
  pickedCaps: number;
  /** Location reward multiplier; picked caps are not multiplied. */
  multiplier: number;
}

export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export function upgradeCost(upgrade: Pick<UpgradeDefinition, 'cost'>, currentLevel: number): number {
  let price = upgrade.cost.base;
  for (let level = 0; level < currentLevel; level += 1) price *= upgrade.cost.growth;
  return roundHalfUp(price);
}

export function runReward(rules: RewardRules, input: RewardInput): number {
  let total = rules.base;
  total += input.duration * rules.perSecond;
  total += input.kills * rules.perKill;
  total += input.wave * rules.perWave;
  if (input.bossKilled) total += rules.bossBonus;
  total *= input.multiplier;
  total += input.pickedCaps;
  return roundHalfUp(total);
}

export interface EmeraldRates { elite: number; boss: number; firstBoss: number }
export interface EmeraldMilestone { atSecond: number; amount: number }

export function emeraldReward(
  rates: EmeraldRates, milestones: readonly EmeraldMilestone[],
  input: { elites: number; bossKilled: boolean; firstBoss: boolean; passed: readonly number[] },
): number {
  let total = input.elites * rates.elite;
  if (input.bossKilled) {
    total += rates.boss;
    if (input.firstBoss) total += rates.firstBoss;
  }
  for (const mark of milestones) if (input.passed.includes(mark.atSecond)) total += mark.amount;
  return total;
}

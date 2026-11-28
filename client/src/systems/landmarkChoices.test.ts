import { describe, expect, it } from 'vitest';
import { getCatalog } from '../content/catalog';
import { choiceCard } from './landmarkChoices';

describe('landmark choice cards', () => {
  const { landmarks, pickups } = getCatalog();
  const choices = landmarks.generator!.choices!;

  it('show price, threat, hold time and the reward range up front', () => {
    const [careful, risky, buy] = choices.map((choice) => choiceCard(choice, 100, pickups));
    expect(careful!.lines).toEqual(['Бесплатно', 'Без боя', 'Держать круг 9\u00a0с', 'Награда: 2–3 случайных']);
    expect(risky!.lines[1]).toMatch(/^Засада: \d+ враг(а|ов)? сразу$/);
    expect(risky!.lines[3]).toContain('+ сундук');
    expect(buy!.lines[0]).toBe(`Цена: ${choices[2]!.caps} крышек`);
    expect(buy!.lines[2]).toBe('Награда сразу');
    expect(buy!.disabled).toBeNull();
  });

  it('lock the paid card with the reason when caps are short', () => {
    const buy = choiceCard(choices[2]!, 3, pickups);
    expect(buy.disabled).toBe(`Не хватает крышек: есть 3 из ${choices[2]!.caps}`);
    expect(choiceCard(choices[0]!, 0, pickups).disabled).toBeNull();
  });

  it('make risk clearly richer than care at both places', () => {
    for (const id of ['generator', 'hatch']) {
      const cards = landmarks[id]!.choices!;
      const careful = cards.find((choice) => choice.id === 'careful')!;
      const risky = cards.find((choice) => choice.id === 'risky')!;
      expect(risky.rolls[0]).toBeGreaterThanOrEqual(careful.rolls[1]);
      expect(risky.guaranteed.length).toBeGreaterThan(0);
    }
  });
});

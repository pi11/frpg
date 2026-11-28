import type { Catalog } from '../content/catalog';
import type { LandmarkChoice } from '../content/schemas';
import { plural } from './runReport';

/** What one choice card says: price, threat, the guaranteed part and the reward range. */
export interface ChoiceCard {
  id: LandmarkChoice['id'];
  title: string;
  description: string;
  lines: string[];
  /** Why the card cannot be taken now (not enough caps); null when it can. */
  disabled: string | null;
}

function seconds(ms: number): string {
  return String(Math.round(ms / 100) / 10).replace('.', ',');
}

export function choiceCard(choice: LandmarkChoice, caps: number, pickups: Catalog['pickups']): ChoiceCard {
  const [low, high] = choice.rolls;
  const range = low === high ? String(low) : `${low}–${high}`;
  const extra = choice.guaranteed.map((id) => (pickups[id]?.name ?? id).toLowerCase());
  const enemies = (count: number): string => `${count} ${plural(count, 'враг', 'врага', 'врагов')}`;
  const lines = [
    choice.caps ? `Цена: ${choice.caps} крышек` : 'Бесплатно',
    choice.ambush
      ? choice.ambush.when === 'choose'
        ? `Засада: ${enemies(choice.ambush.count)} сразу`
        : `Засада после награды: ${enemies(choice.ambush.count)}`
      : 'Без боя',
    choice.holdMs > 0 ? `Держать круг ${seconds(choice.holdMs)}\u00a0с` : 'Награда сразу',
    `Награда: ${range} ${plural(high, 'случайный', 'случайных', 'случайных')}${extra.length ? ` + ${extra.join(', ')}` : ''}`,
  ];
  return {
    id: choice.id, title: choice.title, description: choice.description, lines,
    disabled: choice.caps > caps ? `Не хватает крышек: есть ${caps} из ${choice.caps}` : null,
  };
}

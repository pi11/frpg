import type { Catalog } from './catalog';
import type { LocationDefinition } from './schemas';

/** Unlock order: open locations first, then each one after the location that unlocks it. */
export function orderedLocations(catalog: Catalog): LocationDefinition[] {
  const all = Object.values(catalog.locations);
  const ordered = all.filter((location) => location.unlock.type === 'default');
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!.id;
    for (const location of all) {
      if (location.unlock.type === 'bossKilled' && location.unlock.location === current
        && !ordered.includes(location)) ordered.push(location);
    }
  }
  return [...ordered, ...all.filter((location) => !ordered.includes(location))];
}

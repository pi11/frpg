import { describe, expect, it } from 'vitest';
import { getCatalog } from '../content/catalog';
import { fogPhase, hazardTickDamage, StructureFinder, TurretField, type FogRule, type TurretRule } from './locationRules';
import { generateChunk, structureAt } from './WorldDecor';

const catalog = getCatalog();
const marsh = catalog.locations.toxic_marsh!;
const base = catalog.locations.military_base!;
const fog = marsh.specialRule as FogRule;
const turrets = base.specialRule as TurretRule;

describe('toxic fog', () => {
  it('warns, then fogs, then clears on game time', () => {
    const { firstAtSecond: first, warningSeconds: warning, durationSeconds: duration, everySeconds: every } = fog;
    expect(fogPhase(fog, 0)).toEqual({ state: 'clear' });
    expect(fogPhase(fog, first - warning + 1).state).toBe('warning');
    expect(fogPhase(fog, first + 1)).toEqual({ state: 'fog', secondsLeft: duration - 1 });
    expect(fogPhase(fog, first + duration + 1)).toEqual({ state: 'clear' });
    expect(fogPhase(fog, first + every - 1)).toEqual({ state: 'warning', secondsLeft: 1 });
    expect(fogPhase(fog, first + every + 2).state).toBe('fog');
  });

  it('adds up with ground hazards but never above the cap; radResist reduces both', () => {
    expect(hazardTickDamage(4, 6, 0, 500, 100)).toBe(5);
    expect(hazardTickDamage(40, 60, 0, 500, 6)).toBe(6);
    expect(hazardTickDamage(4, 6, 0.5, 500, 100)).toBe(2.5);
    expect(hazardTickDamage(4, 6, 2, 500, 100)).toBe(0);
  });

  it('finds safe zones only at the listed structures, where the map really puts them', () => {
    const finder = new StructureFinder(7, marsh.decor, fog.safeStructures);
    const zones = finder.around({ x: 0, y: 0 }, 6);
    expect(zones.length).toBeGreaterThan(0);
    for (const zone of zones) {
      const [cx, cy] = zone.key.split(',').map(Number) as [number, number];
      expect(fog.safeStructures).toContain(structureAt(7, cx, cy, marsh.decor)!.id);
      // The chunk really holds the hand-made structure (its items, no random decor).
      expect(generateChunk(7, cx, cy, marsh.decor, catalog.structures).length).toBeGreaterThan(0);
    }
  });
});

describe('defence turrets', () => {
  const hooksFor = (shots: unknown[]) => ({
    target: () => ({ x: 10, y: 10 }),
    shoot: (from: unknown) => { shots.push(from); },
  });

  function field(): TurretField {
    const result = new TurretField(turrets, 3, base.decor);
    result.sync({ x: 0, y: 0 });
    return result;
  }

  it('switch on once after the hold, take the price once, fire, then stay spent', () => {
    const turretField = field();
    const post = [...turretField.posts.values()][0]!;
    expect(post).toBeDefined();
    const shots: unknown[] = [];
    const hooks = hooksFor(shots);
    let paid = 0;
    let now = 0;
    for (; now <= turrets.holdMs + 100; now += 100) paid += turretField.update(now, 100, post, 999, hooks);
    expect(paid).toBe(turrets.caps);
    expect(post.state).toBe('active');
    for (; now < post.until; now += 100) paid += turretField.update(now, 100, post, 999, hooks);
    expect(shots.length).toBeGreaterThan(1);
    turretField.update(now, 100, post, 999, hooks);
    expect(post.state).toBe('spent');
    for (let step = 0; step < 50; step += 1) paid += turretField.update(now + step * 100, 100, post, 999, hooks);
    expect(paid).toBe(turrets.caps);
  });

  it('need the caps and respect the limit of active turrets', () => {
    const turretField = field();
    const post = [...turretField.posts.values()][0]!;
    for (let now = 0; now < turrets.holdMs * 3; now += 100) {
      expect(turretField.update(now, 100, post, turrets.caps - 1, hooksFor([]))).toBe(0);
    }
    expect(post.state).toBe('idle');
    expect(turretField.blocker(turrets.caps - 1)).toContain('крышек');
    for (const other of turretField.posts.values()) {
      if (turretField.active >= turrets.maxActive) break;
      other.state = 'active';
      other.until = Infinity;
    }
    const idle = [...turretField.posts.values()].find((item) => item.state === 'idle');
    if (idle) {
      for (let now = 0; now < turrets.holdMs * 2; now += 100) turretField.update(now, 100, idle, 999, hooksFor([]));
      expect(idle.state).toBe('idle');
      expect(turretField.blocker(999)).toContain('уже работают');
    }
  });

  it('keep their state when the hero comes back', () => {
    const turretField = field();
    const post = [...turretField.posts.values()][0]!;
    post.state = 'spent';
    turretField.sync({ x: 5000, y: 5000 });
    turretField.sync({ x: 0, y: 0 });
    expect(turretField.posts.get(post.key)!.state).toBe('spent');
  });
});

describe('location rules in content', () => {
  it('only the marsh has fog and only the base has turrets', () => {
    for (const location of Object.values(catalog.locations)) {
      const type = location.specialRule?.type;
      if (location.id === 'toxic_marsh') expect(type).toBe('toxicFog');
      else if (location.id === 'military_base') expect(type).toBe('turrets');
      else expect(type).toBeUndefined();
    }
  });
});

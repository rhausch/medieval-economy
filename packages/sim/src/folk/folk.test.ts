import { describe, expect, it } from 'vitest';
import { FOLK } from '../data/folk';
import { TERRAIN } from '../data/terrain';
import { createSim } from '../sim';
import { walkableTable } from './store';

const config = { seed: 3, world: { width: 96, height: 80, noiseScale: 30 } };

describe('Folk', () => {
  it('starts with 20 Folk on walkable land near the settlement', () => {
    const sim = createSim(config);
    const { folk, world } = sim;
    const walkable = walkableTable();
    expect(folk.count).toBe(20);
    for (let s = 0; s < folk.count; s++) {
      expect(walkable[world.terrain[folk.y[s]! * world.width + folk.x[s]!]!]).toBe(1);
      expect(Math.abs(folk.x[s]! - folk.settlement.x)).toBeLessThanOrEqual(FOLK.spawnRadius);
      expect(Math.abs(folk.y[s]! - folk.settlement.y)).toBeLessThanOrEqual(FOLK.spawnRadius);
    }
  });

  it('places the settlement within reach of water', () => {
    const { folk, world } = createSim(config);
    const r = FOLK.settlementWaterDistance;
    let found = false;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = folk.settlement.x + dx;
        const y = folk.settlement.y + dy;
        if (x >= 0 && y >= 0 && x < world.width && y < world.height) {
          if (world.terrain[y * world.width + x] === TERRAIN.water.id) found = true;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('reports an initial spawn event for every Folk', () => {
    const sim = createSim(config);
    const events = sim.drainEvents();
    expect(events.filter((e) => e.type === 'spawn' && e.reason === 'initial')).toHaveLength(20);
    expect(sim.drainEvents()).toHaveLength(0);
  });

  it('is deterministic', () => {
    const a = createSim(config);
    const b = createSim(config);
    for (let i = 0; i < 300; i++) {
      a.step();
      b.step();
    }
    expect(a.folk.x).toEqual(b.folk.x);
    expect(a.folk.satiety).toEqual(b.folk.satiety);
    expect(a.ecology.stock).toEqual(b.ecology.stock);
  });

  it('keeps Folk on walkable tiles with stats in range', () => {
    const sim = createSim(config);
    const walkable = walkableTable();
    for (let i = 0; i < 500; i++) sim.step();
    const { folk, world } = sim;
    for (let s = 0; s < folk.count; s++) {
      expect(walkable[world.terrain[folk.y[s]! * world.width + folk.x[s]!]!]).toBe(1);
      for (const stat of [folk.satiety, folk.health, folk.energy]) {
        expect(stat[s]!).toBeGreaterThanOrEqual(0);
        expect(stat[s]!).toBeLessThanOrEqual(FOLK.maxStat);
      }
    }
  });

  it('eats plant food, which lowers the tile stock and raises satiety', () => {
    const sim = createSim({ ...config, folkCount: 1 });
    sim.drainEvents();
    const { folk, ecology, world } = sim;
    folk.satiety[0] = 10;
    const tile = folk.y[0]! * world.width + folk.x[0]!;
    ecology.species.forEach((d, s) => {
      if (d.kind === 'plant') ecology.stock[s]![tile] = 50;
    });
    const foodBefore = ecology.species.reduce(
      (sum, d, s) => (d.kind === 'plant' ? sum + ecology.stock[s]![tile]! : sum),
      0,
    );
    sim.step();
    const eat = sim.drainEvents().find((e) => e.type === 'eat');
    expect(eat).toBeDefined();
    const foodAfter = ecology.species.reduce(
      (sum, d, s) => (d.kind === 'plant' ? sum + ecology.stock[s]![tile]! : sum),
      0,
    );
    expect(foodAfter).toBeLessThan(foodBefore);
    expect(folk.satiety[0]!).toBeGreaterThan(10);
  });

  it('walks to food when hungry with none underfoot', () => {
    const sim = createSim({ ...config, folkCount: 1 });
    const { folk, ecology, world } = sim;
    ecology.stock.forEach((s) => s.fill(0));
    // Put food a few tiles away on walkable land.
    const walkable = walkableTable();
    let target = -1;
    for (let d = 3; d < 10 && target < 0; d++) {
      const x = folk.x[0]! + d;
      if (x < world.width && walkable[world.terrain[folk.y[0]! * world.width + x]!]) {
        target = folk.y[0]! * world.width + x;
      }
    }
    expect(target).toBeGreaterThanOrEqual(0);
    ecology.stock[0]![target] = 80;
    folk.satiety[0] = 20;
    const startDistance =
      Math.abs((target % world.width) - folk.x[0]!) +
      Math.abs(Math.floor(target / world.width) - folk.y[0]!);
    for (let i = 0; i < 4; i++) sim.step();
    const distance =
      Math.abs((target % world.width) - folk.x[0]!) +
      Math.abs(Math.floor(target / world.width) - folk.y[0]!);
    expect(distance).toBeLessThan(startDistance);
  });

  it('starves without food, then replaces the Folk so the population stays constant', () => {
    const sim = createSim({ ...config, folkCount: 3, ecologyInterval: 1_000_000 });
    sim.ecology.stock.forEach((s) => s.fill(0));
    sim.ecology.capacity.forEach((c) => c.fill(0));
    sim.drainEvents();
    const firstIds = Array.from(sim.folk.id);
    for (let i = 0; i < 1500; i++) sim.step();
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'die' && e.cause === 'starvation')).toBe(true);
    expect(events.some((e) => e.type === 'spawn' && e.reason === 'replacement')).toBe(true);
    expect(sim.folk.count).toBe(3);
    expect(Array.from(sim.folk.id).some((id) => !firstIds.includes(id))).toBe(true);
    for (const health of sim.folk.health) expect(health).toBeGreaterThan(0);
  });

  it('emits move events only when asked', () => {
    const quiet = createSim(config);
    const loud = createSim({ ...config, emitMoves: true });
    for (let i = 0; i < 50; i++) {
      quiet.step();
      loud.step();
    }
    expect(quiet.drainEvents().some((e) => e.type === 'move')).toBe(false);
    expect(loud.drainEvents().some((e) => e.type === 'move')).toBe(true);
  });
});

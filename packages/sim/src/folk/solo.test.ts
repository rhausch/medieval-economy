import { describe, expect, it } from 'vitest';
import { defaultSettings, resolveSettings } from '../config';
import { TERRAIN } from '../data/terrain';
import type { SimEvent } from '../events';
import { carriedTotals } from '../metrics';
import { createSim } from '../sim';
import { mainland, walkableTable } from './store';

const world = { width: 96, height: 80, noiseScale: 30 };

function run(sim: ReturnType<typeof createSim>, ticks: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    all.push(...sim.drainEvents());
  }
  return all;
}

/** Nothing to eat anywhere, so every Folk starves in the end. */
function famine(config: object) {
  const sim = createSim({ seed: 3, world, ecologyInterval: 1_000_000, ...config });
  sim.ecology.stock.forEach((s) => s.fill(0));
  sim.folk.memSpecies.fill(-1);
  sim.folk.memTile.fill(-1);
  sim.drainEvents();
  return sim;
}

const spread = (sim: ReturnType<typeof createSim>): number => {
  let sum = 0;
  let pairs = 0;
  for (let a = 0; a < sim.folk.count; a++) {
    for (let b = a + 1; b < sim.folk.count; b++) {
      sum += Math.hypot(sim.folk.x[a]! - sim.folk.x[b]!, sim.folk.y[a]! - sim.folk.y[b]!);
      pairs++;
    }
  }
  return sum / pairs;
};

describe('solo spawning', () => {
  it('is the default: Folk start far apart, each at a place of its own', () => {
    const sim = createSim({ seed: 3, world });
    expect(sim.settings.folk.spawnRandom).toBe(1);
    // Around one settlement they would all be within a few tiles of each other.
    expect(spread(sim)).toBeGreaterThan(20);
  });

  it('can be switched off, putting everyone around one settlement', () => {
    const sim = createSim({ seed: 3, world, spawnRandom: false });
    expect(spread(sim)).toBeLessThan(10);
  });

  it('puts every Folk on walkable land', () => {
    const sim = createSim({ seed: 3, world, folkCount: 60 });
    const walkable = walkableTable();
    for (let s = 0; s < sim.folk.count; s++) {
      expect(walkable[sim.world.terrain[sim.folk.y[s]! * sim.world.width + sim.folk.x[s]!]!]).toBe(
        1,
      );
    }
  });

  it('only on the main landmass, never on an island it cannot leave', () => {
    const sim = createSim({ seed: 3, world, folkCount: 2 });
    const { width, height } = sim.world;
    // A big continent, a sea gap, and a small island.
    sim.world.terrain.fill(TERRAIN.water.id);
    for (let y = 5; y < 60; y++)
      for (let x = 5; x < 60; x++) sim.world.terrain[y * width + x] = TERRAIN.grass.id;
    for (let y = 10; y < 14; y++)
      for (let x = 80; x < 86; x++) sim.world.terrain[y * width + x] = TERRAIN.grass.id;
    const land = Array.from(mainland(sim.world, walkableTable()));
    expect(land).toHaveLength(55 * 55);
    for (const tile of land) {
      const x = tile % width;
      const y = Math.floor(tile / width);
      expect(x >= 5 && x < 60 && y >= 5 && y < 60 && y < height).toBe(true);
    }
  });

  it('is the same for the same seed and different between seeds', () => {
    const at = (seed: number) => {
      const sim = createSim({ seed, world });
      return [Array.from(sim.folk.x), Array.from(sim.folk.y)];
    };
    expect(at(5)).toEqual(at(5));
    expect(at(5)).not.toEqual(at(6));
  });

  it('gives each Folk knowledge of its own ground, not a shared one', () => {
    const sim = createSim({ seed: 3, world, folkCount: 30 });
    const slots = sim.settings.perception.memorySlots;
    const radius = sim.settings.perception.initialKnowledgeRadius;
    let checked = 0;
    for (let s = 0; s < sim.folk.count; s++) {
      for (let k = 0; k < slots; k++) {
        const at = s * slots + k;
        if (sim.folk.memSpecies[at]! < 0) continue;
        const tile = sim.folk.memTile[at]!;
        const dx = Math.abs((tile % sim.world.width) - sim.folk.x[s]!);
        const dy = Math.abs(Math.floor(tile / sim.world.width) - sim.folk.y[s]!);
        expect(Math.max(dx, dy)).toBeLessThanOrEqual(radius);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('logs where and on what each Folk appeared', () => {
    const sim = createSim({ seed: 3, world, folkCount: 10 });
    const spawns = sim.drainEvents().filter((e) => e.type === 'spawn');
    expect(spawns).toHaveLength(10);
    for (const e of spawns) {
      if (e.type !== 'spawn') continue;
      expect(Object.values(TERRAIN).map((t) => t.key)).toContain(e.terrain);
      expect(e.terrain).toBe(
        Object.values(TERRAIN).find((t) => t.id === sim.world.terrain[e.y * sim.world.width + e.x])!
          .key,
      );
    }
  });

  it('gives a replacement a new random place, not the old one or the settlement', () => {
    const sim = famine({ folkCount: 4 });
    const events = run(sim, 2500);
    const replaced = events.filter((e) => e.type === 'spawn' && e.reason === 'replacement');
    expect(replaced.length).toBeGreaterThan(0);
    const places = new Set(replaced.map((e) => (e.type === 'spawn' ? `${e.x},${e.y}` : '')));
    expect(places.size).toBeGreaterThan(1);
    // Spread across the map, not all around one point.
    const xs = replaced.map((e) => (e.type === 'spawn' ? e.x : 0));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(10);
  });
});

describe('Folk that stay dead', () => {
  it('are not replaced when the setting says so, and the population falls', () => {
    const sim = famine({ folkCount: 6, replaceDead: false });
    expect(sim.aliveCount()).toBe(6);
    const events = run(sim, 3500);
    expect(events.filter((e) => e.type === 'die')).toHaveLength(6);
    expect(events.some((e) => e.type === 'spawn')).toBe(false);
    expect(sim.aliveCount()).toBe(0);
  });

  it('die once, and are then left alone: not moved, fed or counted', () => {
    const sim = famine({ folkCount: 3, replaceDead: false, deciders: ['rules'] });
    const dead = new Set<number>();
    const frozen = new Map<number, { x: number; y: number; reserve: number; age: number }>();
    for (let t = 0; t < 3500; t++) {
      sim.step();
      for (const e of sim.drainEvents()) {
        if (e.type === 'die') {
          expect(dead.has(e.folk)).toBe(false);
          dead.add(e.folk);
        }
      }
      for (let s = 0; s < sim.folk.count; s++) {
        if (sim.folk.alive[s]) continue;
        const now = {
          x: sim.folk.x[s]!,
          y: sim.folk.y[s]!,
          reserve: sim.folk.reserve[s]!,
          age: sim.folk.age[s]!,
        };
        const before = frozen.get(s);
        if (before) expect(now).toEqual(before);
        else frozen.set(s, now);
      }
    }
    expect(dead.size).toBe(3);
  });

  it('carry nothing away with them', () => {
    const sim = famine({ folkCount: 2, replaceDead: false });
    sim.folk.inventory.fill(5);
    // Enough food to live for a while, but not forever.
    run(sim, 6000);
    expect(sim.aliveCount()).toBe(0);
    expect(Object.values(carriedTotals(sim.folk)).every((kg) => kg === 0)).toBe(true);
  });

  it('are the default: a dead Folk is replaced unless told otherwise', () => {
    expect(defaultSettings().folk.replaceDead).toBe(1);
    expect(defaultSettings().folk.spawnRandom).toBe(1);
  });
});

describe('spawn and replacement settings', () => {
  it('are validated and can be set from a configuration', () => {
    expect(() => resolveSettings({ folk: { spawnRandom: 2 } })).toThrow('folk.spawnRandom');
    expect(() => resolveSettings({ folk: { replaceDead: -1 } })).toThrow('folk.replaceDead');
    const s = resolveSettings({ folk: { spawnRandom: 0, replaceDead: 0 } });
    expect(s.folk.spawnRandom).toBe(0);
    expect(s.folk.replaceDead).toBe(0);
    const sim = createSim({ seed: 3, world, settings: s });
    expect(spread(sim)).toBeLessThan(10);
  });
});

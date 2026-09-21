import { describe, expect, it } from 'vitest';
import { resolveSettings, type Settings } from '../config';
import { OPTION, OPTION_COUNT } from '../data/actions';
import { TERRAIN } from '../data/terrain';
import { DECIDERS, MAX_PARAMS, type Senses } from '../deciders';
import { createRng } from '../rng';
import { createSim } from '../sim';
import { createRouter, route, routeTo, search } from './routing';
import { gridOf } from './store';

const BERRIES = 0;
const ROOTS = 1;
const HARE = 2;
const DECK = { width: 60, height: 60 };

/** A flat, grass-covered world with one Folk in the middle who knows nothing, and no food anywhere. */
function field(settings: Settings = resolveSettings({}), at: [number, number] = [30, 30]) {
  const sim = createSim({
    seed: 1,
    settings,
    folkCount: 1,
    deciders: ['rules'],
    ecologyInterval: 1_000_000,
    world: { ...DECK, noiseScale: 10 },
  });
  sim.world.terrain.fill(TERRAIN.grass.id);
  sim.world.elevation.fill(0.5);
  sim.ecology.stock.forEach((s) => s.fill(0));
  sim.folk.x[0] = at[0];
  sim.folk.y[0] = at[1];
  // Well fed and carrying food, so it does nothing but stroll unless a test says otherwise.
  sim.folk.reserve[0] = sim.settings.body.reserveCapacity;
  sim.folk.inventory[0] = 8;
  sim.folk.inventory[2] = 8;
  sim.folk.memSpecies.fill(-1);
  sim.folk.memTile.fill(-1);
  sim.folk.seenCells.fill(-1);
  sim.folk.seenCount[0] = 0;
  sim.drainEvents();
  const tile = (x: number, y: number): number => y * DECK.width + x;
  /** Move the Folk somewhere, dropping whatever it was in the middle of (a real Folk never jumps). */
  const teleport = (x: number, y: number): void => {
    sim.folk.x[0] = x;
    sim.folk.y[0] = y;
    sim.folk.pending[0] = 255;
    sim.folk.goal[0] = 255;
    sim.folk.goalPath[0] = null;
    sim.folk.readyAt[0] = 0;
  };
  const remembered = (): { species: number; tile: number; amount: number }[] => {
    const slots = sim.settings.perception.memorySlots;
    const out = [];
    for (let k = 0; k < slots; k++) {
      if (sim.folk.memSpecies[k]! >= 0) {
        out.push({
          species: sim.folk.memSpecies[k]!,
          tile: sim.folk.memTile[k]!,
          amount: sim.folk.memAmount[k]!,
        });
      }
    }
    return out;
  };
  /** Put stock on a tile, and make the tile a place the species can live (so capacity is not zero). */
  const plant = (species: number, x: number, y: number, amount: number): void => {
    sim.ecology.stock[species]![tile(x, y)] = amount;
  };
  return { sim, tile, remembered, plant, teleport };
}

describe('what a Folk can see', () => {
  it('plants at one tile away but no farther', () => {
    const f = field();
    f.plant(BERRIES, 31, 31, 50); // diagonal neighbour
    f.plant(BERRIES, 32, 30, 50); // two tiles away
    f.sim.look(0);
    const seen = f.remembered().map((r) => r.tile);
    expect(seen).toContain(f.tile(31, 31));
    expect(seen).not.toContain(f.tile(32, 30));
  });

  it('animals at three tiles away but no farther', () => {
    const f = field();
    f.plant(HARE, 33, 27, 5); // three away each way
    f.plant(HARE, 34, 30, 5); // four away
    f.sim.look(0);
    const seen = f.remembered().map((r) => r.tile);
    expect(seen).toContain(f.tile(33, 27));
    expect(seen).not.toContain(f.tile(34, 30));
  });

  it('how much of a species is there, at its range', () => {
    const f = field();
    f.plant(BERRIES, 30, 31, 42);
    f.sim.look(0);
    expect(f.remembered()[0]).toMatchObject({ species: BERRIES, amount: 42 });
  });

  it('ignores tiles with too little to be worth working', () => {
    const f = field();
    f.plant(BERRIES, 30, 31, 1); // below the minimum for gathering
    f.sim.look(0);
    expect(f.remembered()).toHaveLength(0);
  });

  it('with each species’ range set by its own detectRange setting', () => {
    const wider = resolveSettings({
      species: { berries: { detectRange: 3 }, hare: { detectRange: 0 } },
    });
    const f = field(wider);
    f.plant(BERRIES, 33, 30, 50); // three away: seen now
    f.plant(HARE, 31, 30, 5); // adjacent, but hare can no longer be seen
    f.sim.look(0);
    const seen = f.remembered().map((r) => r.tile);
    expect(seen).toContain(f.tile(33, 30));
    expect(seen).not.toContain(f.tile(31, 30));
  });

  it('the lie of the land at ten tiles, marked square by square on its explored map', () => {
    const f = field();
    f.sim.look(0);
    const { cols, rows } = gridOf(f.sim.world, f.sim.settings);
    const size = f.sim.settings.perception.cellSize;
    const seen = (cx: number, cy: number): boolean => f.sim.folk.seenCells[cy * cols + cx]! >= 0;
    // Every square overlapping the 21 x 21 tiles around (30, 30) is marked, and none farther out is.
    let expected = 0;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const near =
          cx * size <= 30 + 10 &&
          (cx + 1) * size - 1 >= 30 - 10 &&
          cy * size <= 30 + 10 &&
          (cy + 1) * size - 1 >= 30 - 10;
        expect(seen(cx, cy), `cell ${cx},${cy}`).toBe(near);
        if (near) expected++;
      }
    }
    expect(f.sim.folk.seenCount[0]).toBe(expected);
    expect(expected).toBeLessThan(cols * rows);
  });

  it('terrain range is a setting: a smaller one explores less ground', () => {
    const small = field(resolveSettings({ perception: { terrainRange: 2 } }));
    const large = field(resolveSettings({ perception: { terrainRange: 20 } }));
    small.sim.look(0);
    large.sim.look(0);
    expect(small.sim.folk.seenCount[0]!).toBeLessThan(large.sim.folk.seenCount[0]!);
    expect(small.sim.folk.seenCount[0]!).toBeLessThanOrEqual(4);
  });
});

describe('what a Folk remembers', () => {
  it('a sighting stays remembered after the Folk walks away', () => {
    const f = field();
    f.plant(BERRIES, 31, 30, 50);
    f.sim.look(0);
    f.teleport(5, 5);
    f.sim.look(0);
    expect(f.remembered().map((r) => r.tile)).toContain(f.tile(31, 30));
  });

  it('merges nearby sightings of one species into one place, keeping the richer tile', () => {
    const f = field();
    f.plant(BERRIES, 30, 31, 20);
    f.plant(BERRIES, 31, 31, 80);
    f.sim.look(0);
    const places = f.remembered().filter((r) => r.species === BERRIES);
    expect(places).toHaveLength(1);
    expect(places[0]!.tile).toBe(f.tile(31, 31));
    expect(places[0]!.amount).toBe(80);
  });

  it('keeps different species and far-apart patches as separate places', () => {
    const f = field();
    f.plant(BERRIES, 30, 31, 50);
    f.plant(ROOTS, 30, 29, 50);
    f.sim.look(0);
    f.teleport(5, 5);
    f.plant(BERRIES, 5, 6, 50);
    f.sim.look(0);
    expect(f.remembered()).toHaveLength(3);
  });

  it('updates how much is there when it sees the place again', () => {
    const f = field();
    f.plant(BERRIES, 30, 31, 50);
    f.sim.look(0);
    f.plant(BERRIES, 30, 31, 12);
    f.sim.look(0);
    expect(f.remembered()[0]!.amount).toBe(12);
  });

  it('forgets a place when it sees it has run out, but not while it is out of sight', () => {
    const f = field();
    f.plant(BERRIES, 30, 31, 50);
    f.sim.look(0);
    f.teleport(5, 5);
    f.plant(BERRIES, 30, 31, 0); // it runs out while nobody is looking
    f.sim.look(0);
    expect(f.remembered()).toHaveLength(1); // still remembered: it cannot tell from here
    f.teleport(30, 30);
    f.sim.look(0);
    expect(f.remembered()).toHaveLength(0);
  });

  it('forgets a place after the configured time unseen', () => {
    const f = field(resolveSettings({ perception: { memoryTicks: 100 } }));
    f.plant(BERRIES, 30, 31, 50);
    f.sim.look(0);
    f.teleport(5, 5);
    for (let t = 0; t < 150; t++) f.sim.step();
    f.sim.look(0);
    expect(f.remembered().some((r) => r.tile === f.tile(30, 31))).toBe(false);
  });

  it('never remembers more places than it has slots, replacing the longest unseen', () => {
    const f = field(resolveSettings({ perception: { memorySlots: 3, mergeRadius: 0 } }));
    for (let i = 0; i < 6; i++) {
      f.teleport(5 + i * 8, 5);
      f.plant(BERRIES, 5 + i * 8, 6, 50);
      for (let t = 0; t < 3; t++) f.sim.step();
      f.sim.look(0);
    }
    const places = f.remembered();
    expect(places).toHaveLength(3);
    // The newest three sightings survive.
    expect(places.map((p) => p.tile).sort()).toEqual(
      [3, 4, 5].map((i) => f.tile(5 + i * 8, 6)).sort(),
    );
  });

  it('starts out knowing its home ground, nearest patches first', () => {
    const f = field(resolveSettings({ perception: { memorySlots: 2 } }));
    f.plant(BERRIES, 30, 33, 50); // 3 away
    f.plant(ROOTS, 30, 40, 50); // 10 away
    f.plant(HARE, 30, 45, 5); // 15 away
    f.sim.learnArea(0, 16);
    const places = f.remembered().map((p) => p.tile);
    expect(places).toHaveLength(2);
    expect(places).toContain(f.tile(30, 33));
    expect(places).toContain(f.tile(30, 40));
    expect(f.sim.folk.seenCount[0]!).toBeGreaterThan(4);
  });
});

describe('exploring', () => {
  it('a hungry Folk that remembers nothing goes to look somewhere new, and marks the ground explored', () => {
    const f = field();
    f.sim.folk.inventory.fill(0);
    f.sim.folk.reserve[0] = 0.4 * f.sim.settings.body.reserveCapacity;
    const before = f.sim.folk.seenCount[0]!;
    let explored = false;
    for (let t = 0; t < 400 && !explored; t++) {
      f.sim.step();
      explored = f.sim.folk.goal[0] === OPTION.explore;
    }
    expect(explored).toBe(true);
    for (let t = 0; t < 400; t++) f.sim.step();
    expect(f.sim.folk.seenCount[0]!).toBeGreaterThan(before + 4);
  });

  it('finds food beyond its sight by exploring, and lives on it', () => {
    const f = field(undefined, [8, 8]);
    for (let y = 26; y < 34; y++) for (let x = 26; x < 34; x++) f.plant(BERRIES, x, y, 80);
    // Hungry, carrying nothing, but with enough reserve to search for a while.
    f.sim.folk.inventory.fill(0);
    f.sim.folk.reserve[0] = 0.9 * f.sim.settings.body.reserveCapacity;
    let gathered = 0;
    let died = false;
    for (let t = 0; t < 4000 && gathered === 0 && !died; t++) {
      f.sim.step();
      for (const e of f.sim.drainEvents()) {
        if (e.type === 'gather') gathered++;
        if (e.type === 'die') died = true;
      }
    }
    expect(died).toBe(false);
    expect(gathered).toBeGreaterThan(0);
  });

  it('does not walk straight to food it has never seen', () => {
    const f = field(undefined, [8, 8]);
    for (let y = 44; y < 50; y++) for (let x = 44; x < 50; x++) f.plant(BERRIES, x, y, 80);
    f.sim.folk.inventory.fill(0);
    f.sim.folk.reserve[0] = 0.5 * f.sim.settings.body.reserveCapacity;
    for (let t = 0; t < 30; t++) {
      f.sim.step();
      const goal = f.sim.folk.goalTile[0]!;
      if (goal >= 0) {
        const gx = goal % DECK.width;
        const gy = Math.floor(goal / DECK.width);
        expect(gx >= 44 && gy >= 44, `goal ${gx},${gy}`).toBe(false);
      }
    }
  });
});

describe('deciders choose among remembered places', () => {
  const rules = DECIDERS.find((d) => d.key === 'rules')!;
  const utility = DECIDERS.find((d) => d.key === 'utility')!;
  const settings = resolveSettings({});

  function senses(
    decider: (typeof DECIDERS)[number],
    values: Record<string, number>,
    places: { option: number; amount?: number; age?: number; ticks?: number }[],
    over: Partial<Senses> = {},
  ): Senses {
    const params = new Float32Array(MAX_PARAMS);
    decider.params.forEach(
      (spec, i) => (params[i] = values[spec.key] ?? (spec.min + spec.max) / 2),
    );
    const n = 32;
    const s: Senses = {
      x: 0,
      y: 0,
      reserve: 0.5 * settings.body.reserveCapacity,
      capacity: settings.body.reserveCapacity,
      injury: 0,
      foodKcal: 0,
      roomKg: 20,
      foraging: 0,
      hunting: 0,
      resting: false,
      durationMultiplier: 1,
      params,
      paramBase: 0,
      memCount: places.length,
      memOption: new Int32Array(n),
      memTile: new Int32Array(n),
      memAmount: new Float32Array(n),
      memAge: new Float32Array(n),
      memTicks: new Float32Array(n),
      memKcal: new Float32Array(n),
      exploreTile: -1,
      exploreTicks: 0,
      unexplored: 0,
      settings,
      ...over,
    };
    places.forEach((p, i) => {
      s.memOption[i] = p.option;
      s.memTile[i] = 1000 + i;
      s.memAmount[i] = p.amount ?? 50;
      s.memAge[i] = p.age ?? 0;
      s.memTicks[i] = p.ticks ?? 5;
      s.memKcal[i] = (p.ticks ?? 5) * 20;
    });
    return s;
  }
  const choose = (
    decider: (typeof DECIDERS)[number],
    s: Senses,
  ): { option: number; tile: number } => {
    const out = { option: -1, tile: -1 };
    decider.decide(s, out, new Float32Array(OPTION_COUNT));
    return out;
  };

  it('rules: go to the nearest remembered place', () => {
    const s = senses(rules, { foodTarget: 12000, riskTolerance: 0 }, [
      { option: OPTION.gather, ticks: 30 },
      { option: OPTION.gather, ticks: 6 },
      { option: OPTION.gather, ticks: 18 },
    ]);
    expect(choose(rules, s)).toEqual({ option: OPTION.gather, tile: 1001 });
  });

  it('rules: leave a plant patch once it is down to the level they give up at', () => {
    const places = [{ option: OPTION.gather, amount: 6, ticks: 3 }];
    const stripper = senses(rules, { foodTarget: 12000, giveUp: 1 }, places);
    const leaver = senses(rules, { foodTarget: 12000, giveUp: 15 }, places);
    expect(choose(rules, stripper).option).toBe(OPTION.gather);
    expect(choose(rules, leaver).option).not.toBe(OPTION.gather);
  });

  it('rules: do not trust a memory older than they trust', () => {
    const places = [{ option: OPTION.gather, age: 20000, ticks: 3 }];
    expect(
      choose(rules, senses(rules, { foodTarget: 12000, maxAge: 5000 }, places)).option,
    ).not.toBe(OPTION.gather);
    expect(choose(rules, senses(rules, { foodTarget: 12000, maxAge: 40000 }, places)).option).toBe(
      OPTION.gather,
    );
  });

  it('rules: explore when nothing remembered is worth going to and there is somewhere to look', () => {
    const s = senses(rules, { foodTarget: 12000 }, [], {
      exploreTile: 77,
      exploreTicks: 12,
      unexplored: 0.8,
    });
    expect(choose(rules, s)).toEqual({ option: OPTION.explore, tile: 77 });
    const nowhere = senses(rules, { foodTarget: 12000 }, []);
    expect(choose(rules, nowhere).option).toBe(OPTION.wander);
  });

  it('utility: prefers a fresh sighting of game to an old one', () => {
    const fresh = { option: OPTION.snare, age: 100, ticks: 10 };
    const old = { option: OPTION.snare, age: 40000, ticks: 10 };
    const s = senses(utility, { halfLife: 2000, wWander: 0 }, [old, fresh]);
    expect(choose(utility, s).tile).toBe(1001); // the fresh one, second in memory
  });

  it('utility: an old sighting of game is worth less than the same place seen recently', () => {
    const score = (age: number): number => {
      const s = senses(utility, { halfLife: 2000, wWander: 0 }, [
        { option: OPTION.snare, age, ticks: 10 },
      ]);
      const scores = new Float32Array(OPTION_COUNT);
      utility.decide(s, { option: 0, tile: 0 }, scores);
      return scores[OPTION.snare]!;
    };
    expect(score(100)).toBeGreaterThan(score(30000));
  });

  it('utility: leaves plant patches it has worked down, and explores when there is nothing to go to', () => {
    const empty = senses(
      utility,
      { giveUp: 20, wWander: 0.1, wExplore: 2 },
      [{ option: OPTION.gather, amount: 8 }],
      {
        exploreTile: 55,
        exploreTicks: 10,
        unexplored: 0.9,
      },
    );
    expect(choose(utility, empty)).toEqual({ option: OPTION.explore, tile: 55 });
  });

  it('utility: a starving Folk that knows no food goes exploring, however little it cares about exploring', () => {
    const s = senses(utility, { wExplore: 0.2, wWander: 0.5 }, [], {
      reserve: 0.35 * settings.body.reserveCapacity,
      exploreTile: 55,
      exploreTicks: 10,
      unexplored: 0.5,
    });
    expect(choose(utility, s).option).toBe(OPTION.explore);
  });
});

describe('A* routes', () => {
  it('find exactly the quickest walk, the same as searching everywhere', () => {
    const sim = createSim({
      seed: 7,
      world: { width: 80, height: 80, noiseScale: 20 },
      folkCount: 1,
    });
    const { world, settings } = sim;
    const router = createRouter(world, settings);
    const rng = createRng(3);
    const walkable: number[] = [];
    for (let i = 0; i < world.terrain.length; i++) {
      const t = world.terrain[i]!;
      if (t !== TERRAIN.water.id && t !== TERRAIN.mountain.id) walkable.push(i);
    }
    let compared = 0;
    for (let trial = 0; trial < 60; trial++) {
      const a = walkable[Math.floor(rng.next() * walkable.length)]!;
      const b = walkable[Math.floor(rng.next() * walkable.length)]!;
      let exhaustive = -1;
      search(world, settings, router, a, (tile, ticks) => {
        if (tile === b) exhaustive = ticks;
        return tile === b;
      });
      const found = route(world, settings, router, a, b);
      expect(found).toBe(exhaustive >= 0);
      if (found) {
        expect(router.dist[b]!).toBeCloseTo(exhaustive, 9);
        const path = routeTo(router, b);
        expect(path[path.length - 1]).toBe(b);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(20);
  });
});

describe('perception settings', () => {
  const rejects = (file: unknown, path: string): void => {
    expect(() => resolveSettings(file)).toThrow(path);
  };

  it('are validated', () => {
    rejects({ perception: { terrainRange: 0 } }, 'perception.terrainRange');
    rejects({ perception: { memorySlots: 2.5 } }, 'perception.memorySlots');
    rejects({ perception: { cellSize: -1 } }, 'perception.cellSize');
    rejects({ perception: { mergeRadius: -1 } }, 'perception.mergeRadius');
    rejects({ perception: { walkEstimate: 0 } }, 'perception.walkEstimate');
    rejects({ species: { berries: { detectRange: -1 } } }, 'species.berries.detectRange');
    rejects({ species: { berries: { detectRange: 1.5 } } }, 'species.berries.detectRange');
  });

  it('default to plants at 1, animals at 3 and terrain at 10 tiles', () => {
    const s = resolveSettings({});
    const range = (key: string): number => s.species.find((sp) => sp.key === key)!.detectRange;
    expect([range('berries'), range('roots'), range('hare'), range('deer')]).toEqual([1, 1, 3, 3]);
    expect(s.perception.terrainRange).toBe(10);
  });
});

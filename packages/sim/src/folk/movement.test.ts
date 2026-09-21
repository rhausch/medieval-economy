import { describe, expect, it } from 'vitest';
import { resolveSettings, type Settings } from '../config';
import { OPTION, OPTION_COUNT } from '../data/actions';
import { TERRAIN } from '../data/terrain';
import { DECIDERS, MAX_PARAMS, type Senses } from '../deciders';
import type { SimEvent } from '../events';
import { createRng } from '../rng';
import { folkCounters, ledgerRows, travelRows } from '../metrics';
import { createSim } from '../sim';

/** Rules Folk that always restock (so they head for food) and never stop to rest. */
const restock = {
  deciders: {
    rules: {
      params: {
        foodTarget: { min: 12000, max: 12000 },
        restIfInjured: { min: 2, max: 2 },
        riskTolerance: { min: 0, max: 0 },
        eatBelow: { min: 0.3, max: 0.3 },
      },
    },
  },
};

function settingsWith(extra: object = {}): Settings {
  return resolveSettings({ ...restock, ...extra });
}

interface Arena {
  sim: ReturnType<typeof createSim>;
  tile: (x: number, y: number) => number;
}

/** A small hand-made world: every tile the given terrain and level ground, one Folk at (x, y), no food. */
function arena(options: {
  width?: number;
  height?: number;
  terrain?: number;
  settings?: Settings;
  at?: [number, number];
}): Arena {
  const width = options.width ?? 40;
  const height = options.height ?? 9;
  const settings = options.settings ?? settingsWith();
  const sim = createSim({
    seed: 1,
    settings,
    folkCount: 1,
    deciders: ['rules'],
    ecologyInterval: 1_000_000,
    timer: () => performance.now(),
    world: { width, height, noiseScale: 10 },
  });
  sim.world.terrain.fill(options.terrain ?? TERRAIN.grass.id);
  sim.world.elevation.fill(0.5);
  sim.ecology.stock.forEach((s) => s.fill(0));
  const [x, y] = options.at ?? [2, Math.floor(height / 2)];
  sim.folk.x[0] = x;
  sim.folk.y[0] = y;
  sim.drainEvents();
  return { sim, tile: (tx, ty) => ty * width + tx };
}

function run(sim: ReturnType<typeof createSim>, ticks: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    all.push(...sim.drainEvents());
  }
  return all;
}

/** A Folk with plenty of food and reserve, so all it does is stroll. */
function wellFed(sim: ReturnType<typeof createSim>): void {
  sim.folk.reserve[0] = sim.settings.body.reserveCapacity;
  sim.folk.inventory[0] = 8; // berries, so no foraging is needed
  sim.folk.inventory[2] = 8; // meat
}

function walked(sim: ReturnType<typeof createSim>) {
  const rows = travelRows(sim.metrics);
  const steps = rows.reduce((sum, r) => sum + r.steps, 0);
  const ticks = rows.reduce((sum, r) => sum + r.ticks, 0);
  const kcal = rows.reduce((sum, r) => sum + r.kcal, 0);
  return { steps, ticks, kcal, perStep: ticks / steps, kcalPerStep: kcal / steps };
}

describe('walking speed by terrain', () => {
  const cases: [string, number, number][] = [
    ['grass', TERRAIN.grass.id, 1],
    ['sand', TERRAIN.sand.id, 0.8],
    ['forest', TERRAIN.forest.id, 0.7],
    ['hills', TERRAIN.hills.id, 0.6],
  ];
  for (const [name, terrain, speed] of cases) {
    it(`takes ${(1 / speed).toFixed(2)} ticks per step on ${name}`, () => {
      const { sim } = arena({ terrain, width: 60, height: 60, at: [30, 30] });
      wellFed(sim);
      run(sim, 800);
      const w = walked(sim);
      expect(w.steps).toBeGreaterThan(40);
      expect(w.perStep).toBeCloseTo(1 / speed, 1);
    });
  }

  it('keeps the average speed exact even though a step rarely ends on a whole tick', () => {
    // Forest: 1 / 0.7 = 1.4286 ticks a step. If each step were rounded up to 2 ticks the average would be 2.
    const { sim } = arena({ terrain: TERRAIN.forest.id, width: 60, height: 60, at: [30, 30] });
    wellFed(sim);
    run(sim, 1500);
    const w = walked(sim);
    expect(Math.abs(w.perStep - 1 / 0.7)).toBeLessThan(0.02);
  });

  it('uses the terrain speeds from the configuration', () => {
    const slow = settingsWith({ movement: { terrainSpeed: { grass: 0.5 } } });
    const { sim } = arena({ settings: slow, width: 60, height: 60, at: [30, 30] });
    wellFed(sim);
    run(sim, 600);
    expect(walked(sim).perStep).toBeCloseTo(2, 1);
  });

  it('burns more calories per step where walking takes longer', () => {
    const cost = (terrain: number): number => {
      const { sim } = arena({ terrain, width: 60, height: 60, at: [30, 30] });
      wellFed(sim);
      run(sim, 800);
      return walked(sim).kcalPerStep;
    };
    const grass = cost(TERRAIN.grass.id);
    const hills = cost(TERRAIN.hills.id);
    expect(grass).toBeCloseTo(sim0Moving(), 0);
    expect(hills / grass).toBeCloseTo(1 / 0.6, 1);
  });
});

function sim0Moving(): number {
  return resolveSettings({}).activity.moving;
}

describe('slope', () => {
  /** Level in y, rising along x, so horizontal steps are up or down slope and vertical steps are level. */
  function slope(): ReturnType<typeof arena> {
    const a = arena({ width: 60, height: 60, at: [30, 30] });
    const { sim } = a;
    for (let y = 0; y < 60; y++)
      for (let x = 0; x < 60; x++) sim.world.elevation[y * 60 + x] = x / 120;
    wellFed(sim);
    return a;
  }

  it('slows walking on a slope', () => {
    const flat = arena({ width: 60, height: 60, at: [30, 30] });
    wellFed(flat.sim);
    run(flat.sim, 1200);
    const steep = slope();
    run(steep.sim, 1200);
    // A rise of 1/120 of the range per tile is 12.5 m over 360 m: a 3.5% grade, so 14% slower on those steps.
    expect(walked(steep.sim).perStep).toBeGreaterThan(walked(flat.sim).perStep * 1.03);
    expect(walked(steep.sim).perStep).toBeLessThan(walked(flat.sim).perStep * 1.14);
  });

  it('charges the calories of climbing on top of walking', () => {
    const flat = arena({ width: 60, height: 60, at: [30, 30] });
    wellFed(flat.sim);
    run(flat.sim, 1200);
    const steep = slope();
    run(steep.sim, 1200);
    const climbKcal = steep.sim.settings.movement.climbKcalPerMeter * 12.5;
    // Only steps that go uphill pay it; roughly a quarter of all steps in a random stroll.
    expect(walked(steep.sim).kcalPerStep).toBeGreaterThan(
      walked(flat.sim).kcalPerStep + climbKcal * 0.1,
    );
  });

  it('still conserves energy with the climb costs', () => {
    const { sim } = slope();
    const start = sim.folk.reserve[0]!;
    // Short enough that the Folk lives on the food it carries: no death and replacement to reset the counters.
    const events = run(sim, 400);
    expect(events.some((e) => e.type === 'die')).toBe(false);
    const eaten = ledgerRows(sim.metrics)
      .filter((r) => r.category === 'eaten')
      .reduce((sum, r) => sum + r.kcal, 0);
    const counters = folkCounters(sim.metrics, 0);
    expect(counters.kcalSpent!).toBeGreaterThan(0);
    expect(Math.abs(sim.folk.reserve[0]! - start - (eaten - counters.kcalSpent!))).toBeLessThan(2);
  });
});

describe('routes', () => {
  /** A strip of grass with a forest block across the middle rows, food at the far end. */
  function crossing(forestSpeed: number): ReturnType<typeof arena> {
    const a = arena({
      width: 30,
      height: 9,
      at: [2, 4],
      settings: settingsWith({ movement: { terrainSpeed: { forest: forestSpeed } } }),
    });
    for (let y = 3; y <= 5; y++)
      for (let x = 10; x <= 16; x++) a.sim.world.terrain[a.tile(x, y)] = TERRAIN.forest.id;
    a.sim.ecology.stock[0]![a.tile(26, 4)] = 80; // berries
    a.sim.folk.reserve[0] = 0.5 * a.sim.settings.body.reserveCapacity;
    return a;
  }

  const forestTilesOnPath = (a: ReturnType<typeof arena>): number => {
    const path = a.sim.folk.goalPath[0];
    expect(path).not.toBeNull();
    return Array.from(path!).filter((t) => a.sim.world.terrain[t] === TERRAIN.forest.id).length;
  };

  it('goes around slow ground when that is quicker', () => {
    const a = crossing(0.5);
    a.sim.step();
    expect(a.sim.folk.goal[0]).toBe(OPTION.gather);
    expect(forestTilesOnPath(a)).toBe(0);
  });

  it('goes straight through it when that is quicker', () => {
    const a = crossing(0.95);
    a.sim.step();
    expect(forestTilesOnPath(a)).toBeGreaterThan(0);
  });

  it('reaches the food and gathers it', () => {
    const a = crossing(0.5);
    const events = run(a.sim, 80);
    expect(events.some((e) => e.type === 'gather')).toBe(true);
  });
});

describe('goals', () => {
  it('keeps the goal on the blackboard and does not decide again while walking to it', () => {
    const a = arena({ width: 40, height: 9, at: [2, 4] });
    a.sim.ecology.stock[0]![a.tile(30, 4)] = 80;
    a.sim.folk.reserve[0] = 0.6 * a.sim.settings.body.reserveCapacity;
    a.sim.step();
    const goalTile = a.sim.folk.goalTile[0]!;
    expect(goalTile).toBe(a.tile(30, 4));
    expect(a.sim.folk.goalTick[0]).toBe(1);
    const decisionsAtStart = a.sim.perf!.scan.count;
    // 28 tiles away: a long walk with no decisions in between.
    run(a.sim, 25);
    expect(a.sim.perf!.scan.count).toBe(decisionsAtStart);
    expect(a.sim.folk.goalTile[0]).toBe(goalTile);
    expect(a.sim.folk.goalPos[0]!).toBeGreaterThan(15);
  });

  it('sets a fresh goal once the work is done', () => {
    const a = arena({ width: 20, height: 9, at: [2, 4] });
    a.sim.ecology.stock[0]![a.tile(6, 4)] = 80;
    a.sim.folk.reserve[0] = 0.6 * a.sim.settings.body.reserveCapacity;
    const events = run(a.sim, 30);
    const gathered = events.find((e) => e.type === 'gather');
    expect(gathered).toBeDefined();
    // The goal that took it there was cleared when it finished; anything on the blackboard now is newer.
    expect(a.sim.folk.goalTick[0]!).toBeGreaterThanOrEqual(gathered!.tick);
  });

  it('strolls as a goal, so a Folk with nothing to do rarely needs to decide', () => {
    const sim = createSim({
      seed: 3,
      folkCount: 6,
      deciders: ['rules'],
      settings: settingsWith(),
      world: { width: 96, height: 80, noiseScale: 30 },
      timer: () => performance.now(),
    });
    sim.folk.reserve.fill(sim.settings.body.reserveCapacity);
    for (let s = 0; s < 6; s++) {
      sim.folk.inventory[s * 3] = 8;
      sim.folk.inventory[s * 3 + 2] = 8;
    }
    run(sim, 500);
    const decisions = sim.perf!.decide.reduce((sum, d) => sum + d.count, 0);
    // A stroll is several steps, and a Folk also stands still for a few ticks: far fewer decisions than ticks.
    expect(decisions / (500 * 6)).toBeLessThan(0.25);
  });

  it('emits goal events only when asked', () => {
    const make = (emitGoals: boolean) =>
      createSim({
        seed: 3,
        folkCount: 4,
        emitGoals,
        world: { width: 64, height: 64, noiseScale: 24 },
      });
    const quiet = make(false);
    const loud = make(true);
    expect(run(quiet, 200).some((e) => e.type === 'goal')).toBe(false);
    const goals = run(loud, 200).filter((e) => e.type === 'goal');
    expect(goals.length).toBeGreaterThan(0);
    for (const g of goals) if (g.type === 'goal') expect(g.ticks).toBeGreaterThanOrEqual(0);
  });
});

describe('interrupts', () => {
  it('drops a walk toward food when the Folk would rather eat, and then it eats', () => {
    const a = arena({ width: 60, height: 9, at: [2, 4] });
    a.sim.ecology.stock[0]![a.tile(55, 4)] = 80;
    // eatBelow is 0.3: start just above it, carrying food, so the reserve crosses it on the way.
    a.sim.folk.reserve[0] = 0.302 * a.sim.settings.body.reserveCapacity;
    a.sim.folk.inventory[2] = 3; // meat
    const events = run(a.sim, 60);
    const at = events.findIndex((e) => e.type === 'interrupt');
    expect(at).toBeGreaterThanOrEqual(0);
    const interrupt = events[at]!;
    expect(interrupt.type === 'interrupt' && interrupt.reason).toBe('hungry');
    expect(events.slice(at).some((e) => e.type === 'eat')).toBe(true);
    // It had not arrived yet: the target is 53 tiles away.
    expect(events.slice(0, at).some((e) => e.type === 'gather')).toBe(false);
  });

  it('does not interrupt a Folk that has no food to eat', () => {
    const a = arena({ width: 60, height: 9, at: [2, 4] });
    a.sim.ecology.stock[0]![a.tile(55, 4)] = 80;
    a.sim.folk.reserve[0] = 0.302 * a.sim.settings.body.reserveCapacity;
    expect(run(a.sim, 60).some((e) => e.type === 'interrupt')).toBe(false);
  });

  it('cannot fire again within the cooldown', () => {
    const cooldown = 40;
    const a = arena({
      width: 60,
      height: 9,
      at: [2, 4],
      settings: settingsWith({ folk: { interruptCooldown: cooldown } }),
    });
    a.sim.ecology.stock[0]![a.tile(55, 4)] = 80;
    a.sim.folk.reserve[0] = 0.302 * a.sim.settings.body.reserveCapacity;
    a.sim.folk.inventory[2] = 3;
    const times = run(a.sim, 200)
      .filter((e) => e.type === 'interrupt')
      .map((e) => e.tick);
    for (let i = 1; i < times.length; i++)
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(cooldown);
  });

  it('drops a walk when the place it was heading for runs out, and picks somewhere else', () => {
    const a = arena({ width: 60, height: 9, at: [2, 4] });
    const berries = a.sim.ecology.stock[0]!;
    berries[a.tile(40, 4)] = 80;
    berries[a.tile(5, 1)] = 80; // another patch, close by but not the nearest by the first scan? it is nearer
    berries[a.tile(5, 1)] = 0;
    berries[a.tile(20, 7)] = 80;
    a.sim.folk.reserve[0] = 0.6 * a.sim.settings.body.reserveCapacity;
    a.sim.step();
    const first = a.sim.folk.goalTile[0]!;
    expect(first).toBe(a.tile(20, 7));
    run(a.sim, 4);
    berries[first] = 0; // someone else got there first
    const events = run(a.sim, 6);
    const interrupt = events.find((e) => e.type === 'interrupt');
    expect(interrupt?.type === 'interrupt' && interrupt.reason).toBe('depleted');
    expect(a.sim.folk.goalTile[0] === first).toBe(false);
  });
});

describe('deciders and interrupts', () => {
  it('an interrupt always means the decider would eat: shouldInterrupt implies decide chooses eat', () => {
    const settings = resolveSettings({});
    const rng = createRng(11);
    for (const decider of DECIDERS) {
      let interrupts = 0;
      for (let trial = 0; trial < 400; trial++) {
        const params = new Float32Array(MAX_PARAMS);
        decider.params.forEach((spec, i) => {
          params[i] = spec.min + rng.next() * (spec.max - spec.min);
        });
        const senses: Senses = {
          x: 0,
          y: 0,
          reserve: rng.next() * settings.body.reserveCapacity,
          capacity: settings.body.reserveCapacity,
          injury: Math.floor(rng.next() * 3),
          foodKcal: rng.next() < 0.7 ? rng.next() * 15000 : 0,
          roomKg: rng.next() * 20,
          foraging: rng.next(),
          hunting: rng.next(),
          resting: false,
          durationMultiplier: 1,
          params,
          paramBase: 0,
          targetTile: Int32Array.from({ length: OPTION_COUNT }, () => (rng.next() < 0.5 ? 5 : -1)),
          targetTicks: Float32Array.from({ length: OPTION_COUNT }, () => rng.next() * 30),
          targetKcal: Float32Array.from({ length: OPTION_COUNT }, () => rng.next() * 500),
          settings,
        };
        if (!decider.shouldInterrupt(senses)) continue;
        interrupts++;
        const out = { option: -1, tile: -1 };
        decider.decide(senses, out, new Float32Array(OPTION_COUNT));
        expect(out.option, `${decider.key} trial ${trial}`).toBe(OPTION.eat);
      }
      expect(interrupts, decider.key).toBeGreaterThan(20);
    }
  });

  it('never wants to interrupt without food to eat', () => {
    const settings = resolveSettings({});
    for (const decider of DECIDERS) {
      const params = new Float32Array(MAX_PARAMS);
      decider.params.forEach((spec, i) => (params[i] = spec.max));
      const senses = {
        reserve: 100,
        capacity: settings.body.reserveCapacity,
        foodKcal: 0,
        params,
        paramBase: 0,
        settings,
      } as unknown as Senses;
      expect(decider.shouldInterrupt(senses)).toBe(false);
    }
  });
});

describe('the whole simulation with movement', () => {
  it('is deterministic', () => {
    const config = { seed: 3, world: { width: 96, height: 80, noiseScale: 30 } };
    const a = createSim(config);
    const b = createSim(config);
    for (let i = 0; i < 500; i++) {
      a.step();
      b.step();
    }
    expect(a.folk.x).toEqual(b.folk.x);
    expect(a.folk.readyAt).toEqual(b.folk.readyAt);
    expect(a.folk.reserve).toEqual(b.folk.reserve);
  });

  it('never leaves Folk on unwalkable tiles', () => {
    const sim = createSim({ seed: 5, world: { width: 96, height: 80, noiseScale: 30 } });
    for (let i = 0; i < 800; i++) {
      sim.step();
      for (let s = 0; s < sim.folk.count; s++) {
        const t = sim.world.terrain[sim.folk.y[s]! * sim.world.width + sim.folk.x[s]!]!;
        expect([TERRAIN.water.id, TERRAIN.mountain.id]).not.toContain(t);
      }
    }
  });
});

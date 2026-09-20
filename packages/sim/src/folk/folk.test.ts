import { describe, expect, it } from 'vitest';
import { OPTION, OPTION_COUNT } from '../data/actions';
import { FOLK, INJURY } from '../data/folk';
import { GOODS_LIST } from '../data/goods';
import { TERRAIN } from '../data/terrain';
import { DECIDERS, MAX_PARAMS, type DeciderDef, type Senses } from '../deciders';
import type { SimEvent } from '../events';
import { createSim } from '../sim';
import { walkableTable } from './store';

const config = { seed: 3, world: { width: 96, height: 80, noiseScale: 30 } };
const plantFood = GOODS_LIST.findIndex((g) => g.key === 'plantFood');
const meat = GOODS_LIST.findIndex((g) => g.key === 'meat');

/** Run steps, collecting every event. */
function run(sim: ReturnType<typeof createSim>, ticks: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    all.push(...sim.drainEvents());
  }
  return all;
}

/**
 * A sim with one Folk and an emptied, frozen ecology, so a test can plant exactly what it needs and
 * the only thing that changes stocks is the Folk.
 */
function bare(deciders = ['rules'], extra = {}) {
  const sim = createSim({
    ...config,
    folkCount: 1,
    deciders,
    ecologyInterval: 1_000_000,
    ...extra,
  });
  sim.ecology.stock.forEach((s) => s.fill(0));
  sim.drainEvents();
  return sim;
}

function speciesIndex(sim: ReturnType<typeof createSim>, key: string): number {
  return sim.ecology.species.findIndex((s) => s.key === key);
}

function tileOf(sim: ReturnType<typeof createSim>, slot = 0): number {
  return sim.folk.y[slot]! * sim.world.width + sim.folk.x[slot]!;
}

function senses(
  decider: DeciderDef,
  values: Record<string, number> = {},
  over: Partial<Senses> = {},
) {
  const params = new Float32Array(MAX_PARAMS);
  decider.params.forEach((spec, i) => {
    params[i] = values[spec.key] ?? (spec.min + spec.max) / 2;
  });
  const s: Senses = {
    x: 0,
    y: 0,
    satiety: 60,
    health: 100,
    energy: 80,
    injury: 0,
    foodSatiety: 0,
    room: FOLK.carryCapacity,
    foraging: 0,
    hunting: 0,
    resting: false,
    durationMultiplier: 1,
    params,
    paramBase: 0,
    targetTile: new Int32Array(OPTION_COUNT).fill(-1),
    targetDist: new Int32Array(OPTION_COUNT),
    ...over,
  };
  return s;
}

function decide(decider: DeciderDef, s: Senses): number {
  const out = { option: -1, tile: -1 };
  decider.decide(s, out, new Float32Array(OPTION_COUNT));
  return out.option;
}

describe('Folk setup', () => {
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

  it('hands out deciders in turn and draws each parameter within its range', () => {
    const sim = createSim(config);
    const events = sim.drainEvents().filter((e) => e.type === 'spawn');
    expect(events).toHaveLength(20);
    const kinds = new Set<string>();
    for (const e of events) {
      if (e.type !== 'spawn') continue;
      kinds.add(e.decider);
      const decider = DECIDERS.find((d) => d.key === e.decider)!;
      expect(e.params).toHaveLength(decider.params.length);
      decider.params.forEach((spec, i) => {
        expect(e.params[i]!).toBeGreaterThanOrEqual(spec.min - 1e-3);
        expect(e.params[i]!).toBeLessThanOrEqual(spec.max + 1e-3);
      });
    }
    expect([...kinds].sort()).toEqual(DECIDERS.map((d) => d.key).sort());
  });

  it('gives Folk of the same decider different parameters', () => {
    const sim = createSim(config);
    const rules = sim
      .drainEvents()
      .filter(
        (e): e is Extract<SimEvent, { type: 'spawn' }> =>
          e.type === 'spawn' && e.decider === 'rules',
      );
    expect(new Set(rules.map((e) => e.params.join(','))).size).toBeGreaterThan(1);
  });

  it('is deterministic', () => {
    const a = createSim(config);
    const b = createSim(config);
    for (let i = 0; i < 400; i++) {
      a.step();
      b.step();
    }
    expect(a.folk.x).toEqual(b.folk.x);
    expect(a.folk.inventory).toEqual(b.folk.inventory);
    expect(a.ecology.stock).toEqual(b.ecology.stock);
  });

  it('keeps Folk on walkable tiles with stats in range', () => {
    const sim = createSim(config);
    const walkable = walkableTable();
    for (let i = 0; i < 600; i++) sim.step();
    const { folk, world } = sim;
    for (let s = 0; s < folk.count; s++) {
      expect(walkable[world.terrain[folk.y[s]! * world.width + folk.x[s]!]!]).toBe(1);
      for (const stat of [folk.satiety, folk.health, folk.energy]) {
        expect(stat[s]!).toBeGreaterThanOrEqual(0);
        expect(stat[s]!).toBeLessThanOrEqual(FOLK.maxStat);
      }
    }
  });

  it('emits move events only when asked', () => {
    const quiet = createSim(config);
    const loud = createSim({ ...config, emitMoves: true });
    expect(run(quiet, 60).some((e) => e.type === 'move')).toBe(false);
    expect(run(loud, 60).some((e) => e.type === 'move')).toBe(true);
  });
});

describe('foraging', () => {
  it('gathers into the inventory and takes exactly that much from the tile', () => {
    const sim = bare();
    const berries = speciesIndex(sim, 'berries');
    const tile = tileOf(sim);
    sim.ecology.stock[berries]![tile] = 50;
    sim.folk.satiety[0] = 90;
    let gathered = 0;
    for (let i = 0; i < 40 && gathered === 0; i++) {
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'gather') gathered += e.amount;
    }
    expect(gathered).toBeGreaterThan(0);
    expect(sim.folk.inventory[plantFood]!).toBeCloseTo(gathered, 4);
    expect(sim.ecology.stock[berries]![tile]!).toBeCloseTo(50 - gathered, 3);
  });

  it('walks to distant food before gathering it', () => {
    const sim = bare(['utility']);
    const { world, folk } = sim;
    const walkable = walkableTable();
    const berries = speciesIndex(sim, 'berries');
    let target = -1;
    for (let d = 4; d < 12 && target < 0; d++) {
      const x = folk.x[0]! + d;
      if (x < world.width && walkable[world.terrain[folk.y[0]! * world.width + x]!]) {
        target = folk.y[0]! * world.width + x;
      }
    }
    expect(target).toBeGreaterThanOrEqual(0);
    sim.ecology.stock[berries]![target] = 80;
    folk.satiety[0] = 20;
    const events = run(sim, 80);
    expect(events.some((e) => e.type === 'gather')).toBe(true);
    expect(sim.ecology.stock[berries]![target]!).toBeLessThan(80);
  });

  it('never carries more than its capacity', () => {
    const sim = createSim({ ...config, folkCount: 4 });
    for (let i = 0; i < 1500; i++) {
      sim.step();
      for (let s = 0; s < sim.folk.count; s++) {
        let weight = 0;
        GOODS_LIST.forEach((g, k) => {
          weight += sim.folk.inventory[s * GOODS_LIST.length + k]! * g.weight;
        });
        expect(weight).toBeLessThanOrEqual(FOLK.carryCapacity + 1e-3);
      }
    }
  });

  it('removes one head and yields meat when a hunt succeeds', () => {
    const sim = bare(['utility']);
    const hare = speciesIndex(sim, 'hare');
    const tile = tileOf(sim);
    sim.folk.satiety[0] = 30;
    let checked = 0;
    for (let i = 0; i < 400 && checked < 3; i++) {
      sim.ecology.stock[hare]![tile] = 6;
      const before = sim.folk.inventory[meat]!;
      sim.step();
      for (const e of sim.drainEvents()) {
        if (e.type !== 'hunt') continue;
        checked++;
        if (e.success) {
          expect(sim.ecology.stock[hare]![tile]!).toBeCloseTo(5, 3);
          expect(sim.folk.inventory[meat]!).toBeGreaterThan(before);
        } else {
          expect(sim.folk.inventory[meat]!).toBeCloseTo(before, 4);
        }
      }
      if (sim.folk.inventory[meat]! > 8) sim.folk.inventory[meat] = 0;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('eats from the inventory, not from the ground', () => {
    const sim = bare();
    sim.folk.satiety[0] = 10;
    sim.folk.inventory[plantFood] = 12;
    const events = run(sim, 4);
    expect(events.some((e) => e.type === 'eat')).toBe(true);
    expect(sim.folk.satiety[0]!).toBeGreaterThan(10);
    expect(sim.folk.inventory[plantFood]!).toBeLessThan(12);
  });

  it('improves a skill with use', () => {
    const sim = bare();
    sim.ecology.stock[speciesIndex(sim, 'berries')]!.fill(60);
    sim.folk.satiety[0] = 60;
    run(sim, 300);
    expect(sim.folk.foraging[0]!).toBeGreaterThan(0);
  });

  it('starves without food, and the replacement keeps the dead Folk’s decider', () => {
    const sim = createSim({ ...config, folkCount: 4, ecologyInterval: 1_000_000 });
    sim.ecology.stock.forEach((s) => s.fill(0));
    sim.ecology.capacity.forEach((c) => c.fill(0));
    const deciderOf = new Map<number, string>();
    let replaced = 0;
    for (const e of sim.drainEvents()) if (e.type === 'spawn') deciderOf.set(e.folk, e.decider);
    const dead: number[] = [];
    for (const e of run(sim, 1500)) {
      if (e.type === 'die') {
        expect(e.cause).toBe('starvation');
        dead.push(e.folk);
      } else if (e.type === 'spawn' && e.reason === 'replacement') {
        const previous = dead.shift()!;
        expect(e.decider).toBe(deciderOf.get(previous));
        deciderOf.set(e.folk, e.decider);
        replaced++;
      }
    }
    expect(replaced).toBeGreaterThan(0);
    expect(sim.folk.count).toBe(4);
  });
});

describe('injury', () => {
  function moves(injury: number): number {
    const sim = bare(['rules'], { emitMoves: true });
    sim.folk.injury[0] = injury;
    sim.folk.injuryTimer[0] = 1e9;
    sim.folk.satiety[0] = 100;
    sim.folk.inventory[plantFood] = 20;
    return run(sim, 600).filter((e) => e.type === 'move').length;
  }

  it('slows walking: minor about half as fast, serious about a tenth', () => {
    const healthy = moves(0);
    const minor = moves(1);
    const serious = moves(2);
    expect(minor).toBeLessThan(healthy * 0.7);
    expect(minor).toBeGreaterThan(healthy * 0.3);
    expect(serious).toBeLessThan(healthy * 0.2);
  });

  it('heals a level at a time, and reports it', () => {
    const sim = bare();
    sim.folk.injury[0] = 2;
    sim.folk.injuryTimer[0] = 3;
    const first = run(sim, 4);
    expect(sim.folk.injury[0]).toBe(1);
    expect(first.some((e) => e.type === 'heal' && e.severity === 'minor')).toBe(true);
    expect(sim.folk.injuryTimer[0]!).toBeGreaterThan(INJURY.healTicks[1]! - 10);
    sim.folk.injuryTimer[0] = 2;
    const second = run(sim, 3);
    expect(sim.folk.injury[0]).toBe(0);
    expect(second.some((e) => e.type === 'heal' && e.severity === 'none')).toBe(true);
  });

  it('can be caused by dangerous work and costs health', () => {
    const sim = bare(['utility']);
    const deer = speciesIndex(sim, 'deer');
    const tile = tileOf(sim);
    sim.folk.satiety[0] = 30;
    let injuries = 0;
    for (let i = 0; i < 3000 && injuries === 0; i++) {
      sim.ecology.stock[deer]![tile] = 4;
      sim.folk.satiety[0] = 30;
      sim.folk.inventory.fill(0);
      sim.folk.injury[0] = 0;
      sim.folk.health[0] = 100;
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'injure') injuries++;
      if (injuries > 0) expect(sim.folk.health[0]!).toBeLessThan(100);
    }
    expect(injuries).toBeGreaterThan(0);
  });
});

describe('deciders', () => {
  const [rules, utility] = [
    DECIDERS.find((d) => d.key === 'rules')!,
    DECIDERS.find((d) => d.key === 'utility')!,
  ];

  it('rules: eat when hungry and carrying food', () => {
    const s = senses(rules, { hungerThreshold: 50 }, { satiety: 30, foodSatiety: 10 });
    expect(decide(rules, s)).toBe(OPTION.eat);
  });

  it('rules: rest when tired, then keep resting until rested', () => {
    expect(decide(rules, senses(rules, { tiredThreshold: 25 }, { energy: 10 }))).toBe(OPTION.rest);
    const half = senses(rules, { restUntil: 70 }, { energy: 50, resting: true });
    expect(decide(rules, half)).toBe(OPTION.rest);
  });

  it('rules: bold Folk take the risky high-yield work, cautious Folk the safe work', () => {
    const targets = { targetTile: Int32Array.from([-1, 5, 6, 7, 8, -1, -1]) };
    const bold = senses(rules, { riskTolerance: 0.9, foodTarget: 20 }, targets);
    const careful = senses(rules, { riskTolerance: 0.1, foodTarget: 20 }, targets);
    expect(decide(rules, bold)).toBe(OPTION.dig);
    expect(decide(rules, careful)).toBe(OPTION.gather);
  });

  it('utility: weights decide between safe and dangerous work', () => {
    const targets = { targetTile: Int32Array.from([-1, 5, -1, -1, 8, -1, -1]), satiety: 40 };
    const timid = senses(utility, { wRisk: 2, wEffort: 2, wYield: 0.6 }, targets);
    const daring = senses(utility, { wRisk: 0, wEffort: 0, wYield: 2 }, targets);
    expect(decide(utility, timid)).toBe(OPTION.gather);
    expect(decide(utility, daring)).toBe(OPTION.chase);
  });

  it('utility: a starving Folk carrying food eats, an exhausted one rests', () => {
    expect(decide(utility, senses(utility, {}, { satiety: 10, foodSatiety: 20 }))).toBe(OPTION.eat);
    expect(decide(utility, senses(utility, { wRest: 2 }, { satiety: 90, energy: 5 }))).toBe(
      OPTION.rest,
    );
  });

  it('utility: an injured Folk values slow work less', () => {
    const targets = { targetTile: Int32Array.from([-1, 5, -1, -1, -1, -1, -1]), satiety: 60 };
    const scoreOf = (s: Senses): number => {
      const scores = new Float32Array(OPTION_COUNT);
      utility.decide(s, { option: 0, tile: 0 }, scores);
      return scores[OPTION.gather]!;
    };
    const healthy = scoreOf(senses(utility, {}, targets));
    const hurt = scoreOf(senses(utility, {}, { ...targets, injury: 2, durationMultiplier: 10 }));
    expect(hurt).toBeLessThan(healthy);
  });

  it('records the options a utility Folk considered', () => {
    const sim = createSim({ ...config, deciders: ['utility'] });
    run(sim, 50);
    const scores = sim.folk.scores.subarray(0, OPTION_COUNT);
    expect(Array.from(scores).some((v) => !Number.isNaN(v))).toBe(true);
  });
});

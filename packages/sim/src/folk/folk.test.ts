import { describe, expect, it } from 'vitest';
import { defaultSettings, resolveSettings } from '../config';
import { OPTION, OPTION_COUNT } from '../data/actions';
import { GOODS_LIST } from '../data/goods';
import { TERRAIN } from '../data/terrain';
import { DECIDERS, MAX_PARAMS, type DeciderDef, type Senses } from '../deciders';
import type { SimEvent } from '../events';
import { createSim } from '../sim';
import { walkableTable } from './store';

const config = { seed: 3, world: { width: 96, height: 80, noiseScale: 30 } };
const settings = defaultSettings();
const CAPACITY = settings.body.reserveCapacity;
const good = (key: string): number => GOODS_LIST.findIndex((g) => g.key === key);
const berries = good('berries');
const meat = good('meat');

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
): Senses {
  const params = new Float32Array(MAX_PARAMS);
  decider.params.forEach((spec, i) => {
    params[i] = values[spec.key] ?? (spec.min + spec.max) / 2;
  });
  return {
    x: 0,
    y: 0,
    reserve: 0.6 * CAPACITY,
    capacity: CAPACITY,
    injury: 0,
    foodKcal: 0,
    roomKg: settings.folk.carryCapacityKg,
    foraging: 0,
    hunting: 0,
    resting: false,
    durationMultiplier: 1,
    params,
    paramBase: 0,
    targetTile: new Int32Array(OPTION_COUNT).fill(-1),
    targetDist: new Int32Array(OPTION_COUNT),
    settings,
    ...over,
  };
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
      expect(Math.abs(folk.x[s]! - folk.settlement.x)).toBeLessThanOrEqual(
        settings.folk.spawnRadius,
      );
      expect(Math.abs(folk.y[s]! - folk.settlement.y)).toBeLessThanOrEqual(
        settings.folk.spawnRadius,
      );
    }
  });

  it('places the settlement within reach of water', () => {
    const { folk, world } = createSim(config);
    const r = settings.folk.settlementWaterDistance;
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

  it('starts every Folk with a calorie reserve inside the configured range', () => {
    const { folk } = createSim(config);
    const { min, max } = settings.body.startReserveFraction;
    for (const reserve of folk.reserve) {
      expect(reserve).toBeGreaterThanOrEqual(min * CAPACITY - 1);
      expect(reserve).toBeLessThanOrEqual(max * CAPACITY + 1);
    }
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

  it('uses the parameter ranges from the configuration', () => {
    const custom = resolveSettings({
      deciders: { rules: { params: { eatBelow: { min: 0.5, max: 0.5 } } } },
    });
    const events = createSim({ ...config, settings: custom, deciders: ['rules'] })
      .drainEvents()
      .filter((e) => e.type === 'spawn');
    for (const e of events) if (e.type === 'spawn') expect(e.params[0]).toBeCloseTo(0.5, 4);
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
    expect(a.folk.reserve).toEqual(b.folk.reserve);
    expect(a.folk.inventory).toEqual(b.folk.inventory);
    expect(a.ecology.stock).toEqual(b.ecology.stock);
  });

  it('keeps Folk on walkable tiles with a reserve between zero and capacity', () => {
    const sim = createSim(config);
    const walkable = walkableTable();
    for (let i = 0; i < 600; i++) sim.step();
    const { folk, world } = sim;
    for (let s = 0; s < folk.count; s++) {
      expect(walkable[world.terrain[folk.y[s]! * world.width + folk.x[s]!]!]).toBe(1);
      expect(folk.reserve[s]!).toBeGreaterThan(0);
      expect(folk.reserve[s]!).toBeLessThanOrEqual(CAPACITY + 1);
    }
  });

  it('emits move events only when asked', () => {
    const quiet = createSim(config);
    const loud = createSim({ ...config, emitMoves: true });
    expect(run(quiet, 60).some((e) => e.type === 'move')).toBe(false);
    expect(run(loud, 60).some((e) => e.type === 'move')).toBe(true);
  });
});

describe('calories', () => {
  it('burns the baseline plus the cost of the current activity every tick', () => {
    const sim = bare();
    sim.folk.reserve[0] = CAPACITY;
    const before = sim.folk.reserve[0]!;
    sim.step();
    // On its first tick a Folk is idle: baseline plus the idle cost.
    expect(before - sim.folk.reserve[0]!).toBeCloseTo(
      settings.body.baselineKcalPerTick + settings.activity.idle,
      3,
    );
  });

  it('takes several ticks to eat a meal, limited by intake per tick', () => {
    const sim = bare();
    sim.folk.reserve[0] = 0.2 * CAPACITY;
    sim.folk.inventory[meat] = 5;
    sim.step();
    const ticks = Math.ceil(settings.body.mealKcal / settings.body.maxIntakeKcalPerTick);
    expect(sim.folk.busyUntil[0]).toBe(1 + ticks);
    const events = run(sim, ticks);
    const meal = events.find((e) => e.type === 'eat');
    expect(meal).toBeDefined();
    if (meal?.type === 'eat') expect(meal.kcal).toBeCloseTo(settings.body.mealKcal, 1);
  });

  it('never eats more than fits in the reserve', () => {
    const sim = bare();
    sim.folk.reserve[0] = CAPACITY - 100;
    sim.folk.inventory[meat] = 5;
    // Rules Folk only eat below a threshold; drop it to zero and use an over-full choice via utility.
    const full = bare(['utility']);
    full.folk.reserve[0] = 0.5 * CAPACITY;
    full.folk.inventory[meat] = 20;
    for (let i = 0; i < 200; i++) {
      full.step();
      expect(full.folk.reserve[0]!).toBeLessThanOrEqual(CAPACITY + 1e-3);
    }
  });

  it('eats the densest food first', () => {
    const sim = bare();
    sim.folk.reserve[0] = 0.2 * CAPACITY;
    sim.folk.inventory[berries] = 5;
    sim.folk.inventory[meat] = 5;
    run(sim, 8);
    expect(sim.folk.inventory[meat]!).toBeLessThan(5);
    expect(sim.folk.inventory[berries]!).toBeCloseTo(5, 3);
  });
});

describe('survival', () => {
  it('in a food-rich world nobody starves, whatever their random parameters', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const sim = createSim({ seed, world: { width: 96, height: 96, noiseScale: 30 } });
      const deaths = run(sim, 2500).filter((e) => e.type === 'die');
      expect(deaths, `seed ${seed}`).toHaveLength(0);
    }
  }, 60_000);
});

describe('foraging', () => {
  it('gathers kilograms into the inventory and takes exactly that much from the tile', () => {
    const sim = bare();
    const stock = sim.ecology.stock[speciesIndex(sim, 'berries')]!;
    const tile = tileOf(sim);
    stock[tile] = 50;
    sim.folk.reserve[0] = 0.95 * CAPACITY;
    let gathered = 0;
    for (let i = 0; i < 40 && gathered === 0; i++) {
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'gather') gathered += e.kg;
    }
    expect(gathered).toBeGreaterThan(0);
    expect(sim.folk.inventory[berries]!).toBeCloseTo(gathered, 4);
    expect(stock[tile]!).toBeCloseTo(50 - gathered, 3);
  });

  it('walks to distant food before gathering it', () => {
    const sim = bare(['utility']);
    const { world, folk } = sim;
    const walkable = walkableTable();
    const stock = sim.ecology.stock[speciesIndex(sim, 'berries')]!;
    let target = -1;
    for (let d = 4; d < 12 && target < 0; d++) {
      const x = folk.x[0]! + d;
      if (x < world.width && walkable[world.terrain[folk.y[0]! * world.width + x]!]) {
        target = folk.y[0]! * world.width + x;
      }
    }
    expect(target).toBeGreaterThanOrEqual(0);
    stock[target] = 80;
    folk.reserve[0] = 0.3 * CAPACITY;
    const events = run(sim, 80);
    expect(events.some((e) => e.type === 'gather')).toBe(true);
    expect(stock[target]!).toBeLessThan(80);
  });

  it('never carries more than its capacity', () => {
    const sim = createSim({ ...config, folkCount: 4 });
    const kgOf = (slot: number): number => {
      let kg = 0;
      GOODS_LIST.forEach((_, k) => {
        kg += sim.folk.inventory[slot * GOODS_LIST.length + k]!;
      });
      return kg;
    };
    for (let i = 0; i < 1500; i++) {
      sim.step();
      for (let s = 0; s < sim.folk.count; s++) {
        expect(kgOf(s)).toBeLessThanOrEqual(settings.folk.carryCapacityKg + 1e-3);
      }
    }
  });

  it('removes one head and yields meat when a hunt succeeds', () => {
    const sim = bare(['utility']);
    const hare = sim.ecology.stock[speciesIndex(sim, 'hare')]!;
    const tile = tileOf(sim);
    sim.folk.reserve[0] = 0.3 * CAPACITY;
    let checked = 0;
    for (let i = 0; i < 400 && checked < 3; i++) {
      hare[tile] = 6;
      const before = sim.folk.inventory[meat]!;
      sim.step();
      for (const e of sim.drainEvents()) {
        if (e.type !== 'hunt') continue;
        checked++;
        if (e.success) {
          expect(hare[tile]!).toBeCloseTo(5, 3);
          expect(sim.folk.inventory[meat]!).toBeCloseTo(before + e.kg, 3);
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
    sim.folk.reserve[0] = 0.2 * CAPACITY;
    sim.folk.inventory[berries] = 6;
    const start = sim.folk.reserve[0]!;
    const events = run(sim, 12);
    expect(events.some((e) => e.type === 'eat')).toBe(true);
    expect(sim.folk.inventory[berries]!).toBeLessThan(6);
    // Net of what it burned, the reserve went up because it ate.
    expect(sim.folk.reserve[0]!).toBeGreaterThan(start - 12 * 100);
  });

  it('improves a skill with use', () => {
    const sim = bare();
    sim.ecology.stock[speciesIndex(sim, 'berries')]!.fill(60);
    sim.folk.reserve[0] = 0.6 * CAPACITY;
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
    for (const e of run(sim, 2500)) {
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
  /** Rules Folk that never rest, so injury is the only thing changing how much they walk. */
  const neverRest = resolveSettings({
    deciders: { rules: { params: { restIfInjured: { min: 2, max: 2 } } } },
  });

  function moves(injury: number): number {
    const sim = bare(['rules'], { emitMoves: true, settings: neverRest });
    sim.folk.injury[0] = injury;
    sim.folk.injuryTimer[0] = 1e9;
    sim.folk.reserve[0] = CAPACITY;
    sim.folk.inventory[berries] = 20;
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
    expect(sim.folk.injuryTimer[0]!).toBeGreaterThan(settings.injury.healTicks[1]! - 10);
    sim.folk.injuryTimer[0] = 2;
    const second = run(sim, 3);
    expect(sim.folk.injury[0]).toBe(0);
    expect(second.some((e) => e.type === 'heal' && e.severity === 'none')).toBe(true);
  });

  it('burns extra calories while healing', () => {
    const hurt = bare();
    const well = bare();
    for (const sim of [hurt, well]) sim.folk.reserve[0] = CAPACITY;
    hurt.folk.injury[0] = 2;
    hurt.folk.injuryTimer[0] = 1e9;
    hurt.step();
    well.step();
    expect(well.folk.reserve[0]! - hurt.folk.reserve[0]!).toBeCloseTo(
      settings.injury.healKcalPerTick[2]!,
      2,
    );
  });

  it('heals faster while resting', () => {
    const sim = bare();
    sim.folk.injury[0] = 1;
    sim.folk.injuryTimer[0] = 100;
    sim.folk.action[0] = 3; // resting
    sim.step();
    expect(sim.folk.injuryTimer[0]!).toBeCloseTo(100 - settings.injury.restHealFactor, 3);
  });

  it('can kill only when the configuration says so', () => {
    const deadly = resolveSettings({ injury: { deathChancePerTick: [0, 0, 1] } });
    const sim = bare(['rules'], { settings: deadly });
    sim.folk.reserve[0] = CAPACITY;
    sim.folk.injury[0] = 2;
    sim.folk.injuryTimer[0] = 1e9;
    const died = run(sim, 3).find((e) => e.type === 'die');
    expect(died?.type === 'die' && died.cause).toBe('injury');

    const safe = bare();
    safe.folk.reserve[0] = CAPACITY;
    safe.folk.injury[0] = 2;
    safe.folk.injuryTimer[0] = 1e9;
    expect(run(safe, 200).some((e) => e.type === 'die')).toBe(false);
  });

  it('can be caused by dangerous work', () => {
    // A utility Folk that cares only about yield, so it goes for the deer.
    const daring = resolveSettings({
      deciders: {
        utility: {
          params: {
            wYield: { min: 2, max: 2 },
            wEffort: { min: 0, max: 0 },
            wRisk: { min: 0, max: 0 },
            wDistance: { min: 0, max: 0 },
            wWander: { min: 0, max: 0 },
          },
        },
      },
    });
    const sim = bare(['utility'], { settings: daring });
    const deer = sim.ecology.stock[speciesIndex(sim, 'deer')]!;
    const tile = tileOf(sim);
    let injuries = 0;
    for (let i = 0; i < 3000 && injuries === 0; i++) {
      deer[tile] = 4;
      sim.folk.reserve[0] = 0.4 * CAPACITY;
      sim.folk.inventory.fill(0);
      sim.folk.injury[0] = 0;
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'injure') injuries++;
    }
    expect(injuries).toBeGreaterThan(0);
  });
});

describe('deciders', () => {
  const [rules, utility] = [
    DECIDERS.find((d) => d.key === 'rules')!,
    DECIDERS.find((d) => d.key === 'utility')!,
  ];

  it('rules: eat when the reserve is low and carrying food', () => {
    const s = senses(rules, { eatBelow: 0.5 }, { reserve: 0.3 * CAPACITY, foodKcal: 2000 });
    expect(decide(rules, s)).toBe(OPTION.eat);
    const fed = senses(rules, { eatBelow: 0.5 }, { reserve: 0.8 * CAPACITY, foodKcal: 2000 });
    expect(decide(rules, fed)).not.toBe(OPTION.eat);
  });

  it('rules: rest when hurt enough, unless starving', () => {
    const hurt = senses(rules, { restIfInjured: 0 }, { injury: 1 });
    expect(decide(rules, hurt)).toBe(OPTION.rest);
    const stubborn = senses(rules, { restIfInjured: 2 }, { injury: 2 });
    expect(decide(rules, stubborn)).not.toBe(OPTION.rest);
    const starving = senses(rules, { restIfInjured: 0 }, { injury: 1, reserve: 0.1 * CAPACITY });
    expect(decide(rules, starving)).not.toBe(OPTION.rest);
  });

  it('rules: bold Folk take the risky high-yield work, cautious Folk the safe work', () => {
    const targets = { targetTile: Int32Array.from([-1, 5, 6, 7, 8, -1, -1]) };
    const bold = senses(rules, { riskTolerance: 0.9, foodTarget: 12000 }, targets);
    const careful = senses(rules, { riskTolerance: 0.1, foodTarget: 12000 }, targets);
    expect(decide(rules, bold)).toBe(OPTION.dig);
    expect(decide(rules, careful)).toBe(OPTION.gather);
  });

  it('rules: nobody starving goes after dangerous game', () => {
    const targets = {
      targetTile: Int32Array.from([-1, -1, -1, -1, 8, -1, -1]),
      reserve: 0.2 * CAPACITY,
    };
    expect(decide(rules, senses(rules, { riskTolerance: 0.9, foodTarget: 12000 }, targets))).toBe(
      OPTION.wander,
    );
  });

  it('utility: weights decide between safe and dangerous work', () => {
    const targets = {
      targetTile: Int32Array.from([-1, 5, -1, -1, 8, -1, -1]),
      reserve: 0.5 * CAPACITY,
    };
    const timid = senses(utility, { wRisk: 2, wEffort: 2, wYield: 0.6, wWander: 0 }, targets);
    const daring = senses(utility, { wRisk: 0, wEffort: 0, wYield: 2, wWander: 0 }, targets);
    expect(decide(utility, timid)).toBe(OPTION.gather);
    expect(decide(utility, daring)).toBe(OPTION.chase);
  });

  it('utility: nobody starves with food in their pocket, however little they care about hunger', () => {
    const indifferent = senses(
      utility,
      { wNeed: 0.2, wWander: 0.5, wYield: 0.2 },
      { reserve: 0.25 * CAPACITY, foodKcal: 3000 },
    );
    expect(decide(utility, indifferent)).toBe(OPTION.eat);
  });

  it('utility: nobody starves with no food, however little they care about yield', () => {
    const targets = { targetTile: Int32Array.from([-1, 5, -1, -1, -1, -1, -1]) };
    const indifferent = senses(
      utility,
      { wYield: 0.2, wWander: 0.5, wEffort: 1 },
      { ...targets, reserve: 0.35 * CAPACITY },
    );
    expect(decide(utility, indifferent)).toBe(OPTION.gather);
    // But a well-fed indifferent Folk with nothing to gain is free to wander.
    const fed = senses(
      utility,
      { wYield: 0.2, wWander: 0.5, wEffort: 1 },
      { ...targets, reserve: 0.9 * CAPACITY, foodKcal: 20000 },
    );
    expect(decide(utility, fed)).toBe(OPTION.wander);
  });

  it('utility: a hungry Folk carrying food eats', () => {
    const s = senses(utility, {}, { reserve: 0.1 * CAPACITY, foodKcal: 3000 });
    expect(decide(utility, s)).toBe(OPTION.eat);
  });

  it('utility: an injured Folk with nothing to do prefers rest, a healthy one does not', () => {
    const hurt = senses(utility, { wRest: 2, wWander: 0.1 }, { injury: 2 });
    expect(decide(utility, hurt)).toBe(OPTION.rest);
    const well = senses(utility, { wRest: 2, wWander: 0.1 }, { injury: 0 });
    expect(decide(utility, well)).not.toBe(OPTION.rest);
  });

  it('utility: an injured Folk values slow work less', () => {
    const targets = {
      targetTile: Int32Array.from([-1, 5, -1, -1, -1, -1, -1]),
      reserve: 0.6 * CAPACITY,
    };
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

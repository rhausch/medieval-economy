import { describe, expect, it } from 'vitest';
import { FOLK_ACTIONS } from './data/folk';
import { GOODS_LIST } from './data/goods';
import { TERRAIN } from './data/terrain';
import { DECIDERS } from './deciders';
import {
  COUNTER,
  COUNTER_COUNT,
  activityRows,
  carriedTotals,
  consumptionRows,
  ledgerRows,
  sourceRows,
  terrainResources,
} from './metrics';
import { TimingStat } from './perf';
import { speciesTotals } from './ecology';
import { createSim } from './sim';

const config = { seed: 3, world: { width: 96, height: 80, noiseScale: 30 } };

function run(sim: ReturnType<typeof createSim>, ticks: number) {
  const events = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

describe('TimingStat', () => {
  it('tracks count, mean and max exactly', () => {
    const stat = new TimingStat();
    for (const ms of [1, 2, 3, 10]) stat.record(ms);
    expect(stat.count).toBe(4);
    expect(stat.meanMs).toBeCloseTo(4, 6);
    expect(stat.maxMs).toBe(10);
  });

  it('estimates quantiles within the histogram resolution and never above the maximum', () => {
    const stat = new TimingStat();
    for (let i = 1; i <= 1000; i++) stat.record(i / 100); // 0.01 .. 10 ms
    expect(stat.quantileMs(0.5)).toBeGreaterThan(5 * 0.8);
    expect(stat.quantileMs(0.5)).toBeLessThan(5 * 1.25);
    expect(stat.quantileMs(0.95)).toBeGreaterThan(9.5 * 0.8);
    expect(stat.quantileMs(0.99)).toBeLessThanOrEqual(10);
    expect(stat.quantileMs(1)).toBeLessThanOrEqual(stat.maxMs);
  });

  it('handles no samples and sub-microsecond samples', () => {
    const stat = new TimingStat();
    expect(stat.quantileMs(0.5)).toBe(0);
    stat.record(0.0000001);
    expect(stat.quantileMs(0.5)).toBeGreaterThan(0);
  });
});

describe('timing in the sim', () => {
  it('records phase and decision timings only when a timer is given', () => {
    expect(createSim(config).perf).toBeNull();
    let now = 0;
    const timed = createSim({ ...config, timer: () => (now += 0.01) });
    run(timed, 100);
    const perf = timed.perf!;
    expect(perf.step.count).toBe(100);
    expect(perf.ecology.count).toBe(100);
    expect(perf.folk.count).toBe(100);
    expect(perf.scan.count).toBeGreaterThan(0);
    const decisions = perf.decide.reduce((sum, s) => sum + s.count, 0);
    expect(decisions).toBe(perf.scan.count);
  });

  it('does not change what the simulation does', () => {
    let now = 0;
    const plain = createSim(config);
    const timed = createSim({ ...config, timer: () => (now += 1) });
    run(plain, 300);
    run(timed, 300);
    expect(timed.folk.x).toEqual(plain.folk.x);
    expect(timed.folk.inventory).toEqual(plain.folk.inventory);
    expect(timed.ecology.stock).toEqual(plain.ecology.stock);
  });
});

describe('metrics', () => {
  const goodOf = (species: string): string =>
    species === 'hare' || species === 'deer' ? 'meat' : species;

  it('accounts for every Folk every tick', () => {
    const sim = createSim(config);
    run(sim, 500);
    const total = activityRows(sim.metrics).reduce((sum, r) => sum + r.folkTicks, 0);
    expect(total).toBe(sim.folk.count * 500);
    expect(new Set(activityRows(sim.metrics).map((r) => r.action))).toEqual(new Set(FOLK_ACTIONS));
  });

  it('conserves food: every kilogram taken from the world is eaten or still carried', () => {
    const sim = createSim(config);
    const events = run(sim, 1500);
    expect(events.some((e) => e.type === 'die')).toBe(false);

    const carried = carriedTotals(sim.folk);
    const eaten = new Map<string, number>();
    for (const row of consumptionRows(sim.metrics)) {
      eaten.set(row.good, (eaten.get(row.good) ?? 0) + row.kg);
    }
    const taken = new Map<string, number>();
    for (const row of sourceRows(sim.metrics)) {
      const good = goodOf(row.species);
      taken.set(good, (taken.get(good) ?? 0) + row.kg);
    }
    for (const good of GOODS_LIST) {
      expect(taken.get(good.key) ?? 0).toBeCloseTo(
        (eaten.get(good.key) ?? 0) + carried[good.key]!,
        2,
      );
    }
    expect(taken.get('berries')!).toBeGreaterThan(0);
  });

  it('conserves energy: each Folk’s reserve changes by exactly what it ate minus what it burned', () => {
    const sim = createSim(config);
    const start = Float64Array.from(sim.folk.reserve);
    const events = run(sim, 1500);
    expect(events.some((e) => e.type === 'die')).toBe(false);
    for (let slot = 0; slot < sim.folk.count; slot++) {
      const eaten = sim.metrics.folk[slot * COUNTER_COUNT + COUNTER.kcalEaten]!;
      const spent = sim.metrics.folk[slot * COUNTER_COUNT + COUNTER.kcalSpent]!;
      // The reserve is a 32-bit float, so allow for rounding over millions of kcal of turnover.
      expect(Math.abs(sim.folk.reserve[slot]! - start[slot]! - (eaten - spent))).toBeLessThan(2);
    }
  });

  it('keeps the energy ledger consistent with the per-Folk counters', () => {
    const sim = createSim(config);
    run(sim, 1200);
    let counterSpent = 0;
    let counterEaten = 0;
    for (let slot = 0; slot < sim.folk.count; slot++) {
      counterSpent += sim.metrics.folk[slot * COUNTER_COUNT + COUNTER.kcalSpent]!;
      counterEaten += sim.metrics.folk[slot * COUNTER_COUNT + COUNTER.kcalEaten]!;
    }
    const ledger = ledgerRows(sim.metrics);
    const out = ledger.filter((r) => r.category !== 'eaten').reduce((sum, r) => sum + r.kcal, 0);
    const activity = activityRows(sim.metrics).reduce((sum, r) => sum + r.kcal, 0);
    expect(out + activity).toBeCloseTo(counterSpent, 0);
    const eaten = ledger.filter((r) => r.category === 'eaten').reduce((sum, r) => sum + r.kcal, 0);
    expect(eaten).toBeCloseTo(counterEaten, 0);
    // Baseline is charged every Folk-tick at exactly the configured rate.
    const baseline = ledger
      .filter((r) => r.category === 'baseline')
      .reduce((sum, r) => sum + r.kcal, 0);
    expect(baseline).toBeCloseTo(sim.settings.body.baselineKcalPerTick * sim.folk.count * 1200, 0);
  });

  it('records food sources on foraging terrain only, with successes never above attempts', () => {
    const sim = createSim(config);
    run(sim, 1500);
    const rows = sourceRows(sim.metrics);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.successes).toBeLessThanOrEqual(row.attempts);
      expect([TERRAIN.water.key, TERRAIN.mountain.key]).not.toContain(row.terrain);
      if (row.kg > 0) expect(row.successes).toBeGreaterThan(0);
      expect(DECIDERS.map((d) => d.key)).toContain(row.decider);
      const density = GOODS_LIST.find((g) => g.key === goodOf(row.species))!.kcalPerKg;
      expect(row.kcal).toBeCloseTo(row.kg * density, 2);
    }
  });

  it('reports the terrain breakdown consistent with the world totals', () => {
    const sim = createSim(config);
    run(sim, 50);
    const rows = terrainResources(sim.world, sim.ecology);
    const totals = speciesTotals(sim.ecology);
    sim.ecology.species.forEach((species, s) => {
      const stock = rows
        .filter((r) => r.species === species.key)
        .reduce((sum, r) => sum + r.stock, 0);
      expect(stock).toBeCloseTo(totals[s]!, 0);
    });
    const berries = rows.filter((r) => r.species === 'berries');
    expect(berries.reduce((sum, r) => sum + r.tiles, 0)).toBe(sim.world.terrain.length);
    const water = berries.find((r) => r.terrain === TERRAIN.water.key)!;
    expect(water.stock).toBe(0);
    expect(water.habitable).toBe(0);
    for (const r of rows) expect(r.stock).toBeLessThanOrEqual(r.capacity + 1e-3);
  });

  it('gives a dying Folk a lifetime summary and starts its replacement from zero', () => {
    const sim = createSim({ ...config, folkCount: 2, ecologyInterval: 1_000_000 });
    sim.ecology.stock.forEach((s) => s.fill(0));
    sim.ecology.capacity.forEach((c) => c.fill(0));
    const deaths = run(sim, 2500).filter((e) => e.type === 'die');
    expect(deaths.length).toBeGreaterThan(0);
    for (const d of deaths) {
      if (d.type !== 'die') continue;
      expect(d.lived).toBeGreaterThan(0);
      expect(d.stats.kcalSpent!).toBeGreaterThan(0);
      expect(Object.keys(d.stats)).toContain('meals');
    }
    // A Folk that has just been replaced has fresh counters.
    for (let slot = 0; slot < sim.folk.count; slot++) {
      if (sim.folk.age[slot]! < 5) {
        expect(sim.metrics.folk[slot * COUNTER_COUNT + COUNTER.kcalSpent]!).toBeLessThan(300);
      }
    }
  });
});

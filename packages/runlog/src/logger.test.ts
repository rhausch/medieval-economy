import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSim, resolveSettings } from '@folk/sim';
import { startRun } from './logger';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function outputDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'folk-runlog-'));
  dirs.push(d);
  return d;
}

const simConfig = { seed: 5, folkCount: 4, world: { width: 48, height: 40, noiseScale: 16 } };
const GOODS = 3;

describe('startRun', () => {
  it('writes a manifest, events, entity snapshots and resource totals', () => {
    const sim = createSim(simConfig);
    // Hungry Folk carrying meat, so there is eating to log.
    sim.folk.reserve.fill(3000);
    for (let slot = 0; slot < sim.folk.count; slot++) sim.folk.inventory[slot * GOODS + 2] = 5;
    const out = outputDir();
    const log = startRun(sim, { outputDir: out, snapshotInterval: 10, extra: { note: 'test' } });
    log.record(sim);
    for (let i = 0; i < 95; i++) {
      sim.step();
      log.record(sim);
    }
    log.close(sim);

    expect(readdirSync(out)).toEqual([log.runId]);
    const manifest = JSON.parse(readFileSync(join(log.dir, 'manifest.json'), 'utf8'));
    expect(manifest.seed).toBe(5);
    expect(manifest.ticks).toBe(95);
    expect(manifest.folkCount).toBe(4);
    expect(manifest.note).toBe('test');
    expect(manifest.world.width).toBe(48);
    expect(manifest.endedAt).not.toBeNull();
    expect(manifest.species).toEqual(['berries', 'roots', 'hare', 'deer', 'forage']);
    expect(manifest.goods).toEqual(['berries', 'roots', 'meat']);
    expect(manifest.deciders.map((d: { key: string }) => d.key)).toEqual(['rules', 'utility']);
    expect(manifest.deciders[0].params[0]).toMatchObject({ key: 'eatBelow', min: 0.15, max: 0.7 });

    const events = readFileSync(join(log.dir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const spawns = events.filter((e) => e.type === 'spawn');
    expect(spawns).toHaveLength(4);
    for (const e of spawns) {
      expect(Array.isArray(e.params)).toBe(true);
      expect(e.reserve).toBeGreaterThan(0);
    }
    expect(events.some((e) => e.type === 'eat')).toBe(true);
    for (const e of events) expect(typeof e.tick).toBe('number');

    const entityRows = readFileSync(join(log.dir, 'entities.csv'), 'utf8').trim().split('\n');
    const header = entityRows[0]!.split(',');
    // Snapshots at ticks 0, 10, ..., 90 plus a final one at 95, for 4 Folk each.
    expect(entityRows).toHaveLength(1 + 11 * 4);
    for (const row of entityRows.slice(1)) expect(row.split(',')).toHaveLength(header.length);
    for (const column of [
      'reserve',
      'decider',
      'injury',
      'places',
      'explored',
      'inv_berries',
      'inv_meat',
    ]) {
      expect(header).toContain(column);
    }
    expect(header).not.toContain('satiety');

    const resourceRows = readFileSync(join(log.dir, 'resources.csv'), 'utf8').trim().split('\n');
    expect(resourceRows[0]).toBe(
      'tick,berries,roots,hare,deer,forage,carried_berries,carried_roots,carried_meat',
    );
    expect(resourceRows).toHaveLength(1 + 11);
    expect(resourceRows[resourceRows.length - 1]!.startsWith('95,')).toBe(true);
  });

  it('records the full settings and a hash of them in the manifest', () => {
    const read = (settings?: ReturnType<typeof resolveSettings>) => {
      const sim = createSim({ ...simConfig, settings });
      const log = startRun(sim, { outputDir: outputDir() });
      log.close(sim);
      return JSON.parse(readFileSync(join(log.dir, 'manifest.json'), 'utf8'));
    };
    const plain = read();
    const tweaked = read(resolveSettings({ body: { baselineKcalPerTick: 9 } }));
    expect(plain.settings.body.baselineKcalPerTick).toBe(7.9);
    expect(tweaked.settings.body.baselineKcalPerTick).toBe(9);
    expect(plain.settingsHash).toMatch(/^[0-9a-f]{16}$/);
    expect(tweaked.settingsHash).not.toBe(plain.settingsHash);
    expect(read().settingsHash).toBe(plain.settingsHash);
    // The recorded settings are exactly what a configuration file would contain.
    expect(resolveSettings(plain.settings)).toEqual(createSim(simConfig).settings);
  });

  it('keeps folders distinct when runs start in the same second', () => {
    const out = outputDir();
    const a = startRun(createSim(simConfig), { outputDir: out });
    const b = startRun(createSim(simConfig), { outputDir: out });
    expect(a.dir).not.toBe(b.dir);
    expect(readdirSync(out)).toHaveLength(2);
  });

  it('writes terrain food, activity, ledger, sources, consumption, lifetimes and timing', () => {
    const sim = createSim({ ...simConfig, timer: () => performance.now() });
    const out = outputDir();
    const log = startRun(sim, { outputDir: out, metricsInterval: 50 });
    log.record(sim);
    for (let i = 0; i < 400; i++) {
      sim.step();
      log.record(sim);
    }
    log.close(sim);
    const read = (name: string): string[][] =>
      readFileSync(join(log.dir, name), 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split(','));

    const terrain = read('terrain_resources.csv');
    expect(terrain[0]).toEqual([
      'tick',
      'terrain',
      'species',
      'tiles',
      'habitable',
      'depleted',
      'stock',
      'capacity',
    ]);
    // Snapshots at ticks 0, 50, ..., 400: 9 of them, 6 terrains x 5 species each.
    expect(terrain.length - 1).toBe(9 * 6 * 5);

    const activity = read('activity.csv');
    expect(activity[0]).toEqual(['tick', 'decider', 'action', 'folkTicks', 'kcal']);
    const last = activity.filter((row) => row[0] === '400');
    expect(last.length).toBe(2 * 8);
    expect(last.reduce((sum, row) => sum + Number(row[3]), 0)).toBe(4 * 400);

    const ledger = read('ledger.csv');
    expect(ledger[0]).toEqual(['tick', 'decider', 'category', 'kcal']);
    expect(new Set(ledger.slice(1).map((r) => r[2]))).toEqual(
      new Set(['eaten', 'baseline', 'healing']),
    );
    const baseline = ledger
      .filter((r) => r[0] === '400' && r[2] === 'baseline')
      .reduce((sum, r) => sum + Number(r[3]), 0);
    expect(baseline).toBeCloseTo(7.9 * 4 * 400, 1);

    expect(read('food_sources.csv')[0]).toEqual([
      'tick',
      'decider',
      'species',
      'terrain',
      'attempts',
      'successes',
      'kg',
      'kcal',
    ]);
    expect(read('food_sources.csv').length).toBeGreaterThan(1);
    expect(read('consumption.csv')[0]).toEqual(['tick', 'decider', 'good', 'kg', 'kcal']);

    const travel = read('travel.csv');
    expect(travel[0]).toEqual(['tick', 'decider', 'terrain', 'steps', 'ticks', 'kcal']);
    const walked = travel.filter((r) => r[0] === '400');
    expect(walked.length).toBeGreaterThan(0);
    for (const row of walked) {
      // A step never takes less than a tick (terrain only slows walking down).
      expect(Number(row[4])).toBeGreaterThanOrEqual(Number(row[3]) - 1e-6);
    }

    const lifetimes = read('lifetimes.csv');
    expect(lifetimes[0]!.slice(0, 8)).toEqual([
      'id',
      'decider',
      'born',
      'died',
      'cause',
      'lived',
      'startReserve',
      'endReserve',
    ]);
    expect(lifetimes[0]).toContain('kcalEaten');
    expect(lifetimes[0]).toContain('kcalSpent');
    expect(lifetimes[0]).toContain('goals');
    expect(lifetimes[0]).toContain('interrupts');
    expect(lifetimes[0]).toContain('p11');
    expect(lifetimes[0]).toContain('discoveries');
    expect(lifetimes[0]).toContain('explores');
    expect(lifetimes.length - 1).toBe(4);
    for (const row of lifetimes.slice(1)) expect(row).toHaveLength(lifetimes[0]!.length);

    const timing = JSON.parse(readFileSync(join(log.dir, 'performance.json'), 'utf8'));
    expect(timing.ticks).toBe(400);
    expect(timing.step.count).toBe(400);
    expect(timing.decide.rules.count + timing.decide.utility.count).toBe(timing.scan.count);
    expect(timing.step.p95Ms).toBeGreaterThanOrEqual(timing.step.p50Ms);
  });
});

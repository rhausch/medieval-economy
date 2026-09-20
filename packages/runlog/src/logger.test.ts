import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSim } from '@folk/sim';
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

describe('startRun', () => {
  it('writes a manifest, events, entity snapshots and resource totals', () => {
    const sim = createSim(simConfig);
    sim.folk.satiety.fill(30);
    for (let slot = 0; slot < sim.folk.count; slot++) sim.folk.inventory[slot * 2] = 10;
    const out = outputDir();
    const log = startRun(sim, {
      outputDir: out,
      snapshotInterval: 10,
      extra: { decider: 'rules' },
    });
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
    expect(manifest.decider).toBe('rules');
    expect(manifest.world.width).toBe(48);
    expect(manifest.endedAt).not.toBeNull();
    expect(manifest.species).toEqual(['berries', 'roots', 'hare', 'deer']);

    const events = readFileSync(join(log.dir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(events.filter((e) => e.type === 'spawn')).toHaveLength(4);
    expect(events.some((e) => e.type === 'eat')).toBe(true);
    for (const e of events) expect(typeof e.tick).toBe('number');

    const entityRows = readFileSync(join(log.dir, 'entities.csv'), 'utf8').trim().split('\n');
    const header = entityRows[0]!.split(',');
    // Snapshots at ticks 0, 10, ..., 90 plus a final one at 95, for 4 Folk each.
    expect(entityRows).toHaveLength(1 + 11 * 4);
    for (const row of entityRows.slice(1)) expect(row.split(',')).toHaveLength(header.length);
    expect(header).toContain('inv_plantFood');
    expect(header).toContain('decider');
    expect(header).toContain('injury');
    expect(manifest.deciders.map((d: { key: string }) => d.key)).toEqual(['rules', 'utility']);
    expect(events.filter((e) => e.type === 'spawn').every((e) => Array.isArray(e.params))).toBe(
      true,
    );

    const resourceRows = readFileSync(join(log.dir, 'resources.csv'), 'utf8').trim().split('\n');
    expect(resourceRows[0]).toBe('tick,berries,roots,hare,deer,carried_plantFood,carried_meat');
    expect(resourceRows).toHaveLength(1 + 11);
    expect(resourceRows[resourceRows.length - 1]!.startsWith('95,')).toBe(true);
  });

  it('keeps folders distinct when runs start in the same second', () => {
    const out = outputDir();
    const a = startRun(createSim(simConfig), { outputDir: out });
    const b = startRun(createSim(simConfig), { outputDir: out });
    expect(a.dir).not.toBe(b.dir);
    expect(readdirSync(out)).toHaveLength(2);
  });

  it('writes terrain food, activity, sources, consumption, lifetimes and timing', () => {
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
      'stock',
      'capacity',
    ]);
    // Snapshots at ticks 0, 50, ..., 400: 9 of them, 6 terrains x 4 species each.
    expect(terrain.length - 1).toBe(9 * 6 * 4);

    const activity = read('activity.csv');
    const last = activity.filter((row) => row[0] === '400');
    expect(last.length).toBe(2 * 8);
    const folkTicks = last.reduce((sum, row) => sum + Number(row[3]), 0);
    expect(folkTicks).toBe(4 * 400);

    expect(read('food_sources.csv').length).toBeGreaterThan(1);
    expect(read('consumption.csv').length).toBeGreaterThan(1);

    const lifetimes = read('lifetimes.csv');
    expect(lifetimes[0]!.slice(0, 6)).toEqual(['id', 'decider', 'born', 'died', 'cause', 'lived']);
    expect(lifetimes[0]).toContain('meals');
    expect(lifetimes[0]).toContain('p7');
    expect(lifetimes.length - 1).toBe(4);
    for (const row of lifetimes.slice(1)) expect(row).toHaveLength(lifetimes[0]!.length);

    const timing = JSON.parse(readFileSync(join(log.dir, 'performance.json'), 'utf8'));
    expect(timing.ticks).toBe(400);
    expect(timing.step.count).toBe(400);
    expect(timing.decide.rules.count + timing.decide.utility.count).toBe(timing.scan.count);
    expect(timing.step.p95Ms).toBeGreaterThanOrEqual(timing.step.p50Ms);
  });
});

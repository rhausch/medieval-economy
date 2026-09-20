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

    const resourceRows = readFileSync(join(log.dir, 'resources.csv'), 'utf8').trim().split('\n');
    expect(resourceRows[0]).toBe('tick,berries,roots,hare,deer');
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
});

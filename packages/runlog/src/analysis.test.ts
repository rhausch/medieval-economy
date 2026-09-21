import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createSim } from '@folk/sim';
import { startRun } from './logger';

const script = fileURLToPath(new URL('../../../scripts/analyze_run.py', import.meta.url));
const hasPython = spawnSync('python3', ['-c', 'import pandas, matplotlib']).status === 0;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// Guards the log format: the Python analysis reads every file the logger writes.
describe.skipIf(!hasPython)('scripts/analyze_run.py', () => {
  it('analyzes a freshly logged run and writes every plot', () => {
    const out = mkdtempSync(join(tmpdir(), 'folk-analysis-'));
    dirs.push(out);
    const sim = createSim({
      seed: 4,
      folkCount: 6,
      world: { width: 64, height: 64, noiseScale: 24 },
      timer: () => performance.now(),
    });
    const log = startRun(sim, { outputDir: out, snapshotInterval: 10, metricsInterval: 50 });
    log.record(sim);
    for (let i = 0; i < 300; i++) {
      sim.step();
      log.record(sim);
    }
    log.close(sim);

    const result = spawnSync('python3', [script, log.dir], { encoding: 'utf8' });
    expect(result.stderr).not.toMatch(/Traceback/);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('time by action');
    expect(result.stdout).toContain('timing (microseconds)');
    for (const plot of [
      'food_over_time',
      'terrain_fill',
      'time_by_action',
      'calories',
      'reserve',
      'movement',
      'patches',
      'knowledge',
      'survival',
      'food_sources',
      'lifetimes',
    ]) {
      expect(existsSync(join(log.dir, 'analysis', `${plot}.png`))).toBe(true);
    }
  }, 60_000);
});

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const run = (script: string, args: string[]) =>
  spawnSync('npx', ['tsx', join('packages/cli/src', script), ...args], {
    cwd: root,
    encoding: 'utf8',
  });

mkdirSync(join(root, 'experiments/output'), { recursive: true });

describe('benchmark command', () => {
  it('reports throughput and decision timing for each mode and Folk count', () => {
    const result = run('bench.ts', [
      '--folk',
      '10,30',
      '--deciders',
      'rules,mixed',
      '--size',
      '64',
      '--ticks',
      '40',
      '--warmup',
      '10',
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ticks/s');
    expect(result.stdout).toContain('us/folk');
    const lines = result.stdout.split('\n').filter((l) => /^\s+(rules|mixed)\s+\d+/.test(l));
    expect(lines).toHaveLength(4);
    const file = result.stdout.match(/results: (.*)/)?.[1];
    expect(file).toBeTruthy();
    const saved = JSON.parse(readFileSync(file!, 'utf8'));
    expect(saved.rows).toHaveLength(4);
    rmSync(file!);
  }, 60_000);
});

describe('run command', () => {
  it('runs headless, logs the run and prints timing', () => {
    const before = new Set(readdirSync(join(root, 'experiments/output')));
    const result = run('main.ts', ['--seed', '2', '--ticks', '60', '--size', '64', '--folk', '6']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('per tick:');
    const folder = result.stdout.match(/log: (.*)/)?.[1];
    expect(folder).toBeTruthy();
    const manifest = JSON.parse(readFileSync(join(folder!, 'manifest.json'), 'utf8'));
    expect(manifest.timed).toBe(true);
    expect(manifest.ticks).toBe(60);
    const created = readdirSync(join(root, 'experiments/output')).filter((f) => !before.has(f));
    for (const f of created)
      rmSync(join(root, 'experiments/output', f), { recursive: true, force: true });
  }, 60_000);

  it('runs with a configuration file and records it in the manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'folk-cli-config-'));
    const config = join(dir, 'hungry.json');
    writeFileSync(config, JSON.stringify({ body: { baselineKcalPerTick: 15.8 } }));
    const before = new Set(readdirSync(join(root, 'experiments/output')));
    const result = run('main.ts', [
      '--config',
      config,
      '--seed',
      '2',
      '--ticks',
      '40',
      '--size',
      '64',
      '--folk',
      '4',
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('hungry.json');
    const folder = result.stdout.match(/log: (.*)/)?.[1];
    const manifest = JSON.parse(readFileSync(join(folder!, 'manifest.json'), 'utf8'));
    expect(manifest.settings.body.baselineKcalPerTick).toBe(15.8);
    expect(manifest.configPath).toBe(config);
    // 4 Folk for 40 ticks at 15.8 kcal per tick.
    const ledger = readFileSync(join(folder!, 'ledger.csv'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => l.split(','))
      .filter((r) => r[0] === '40' && r[2] === 'baseline')
      .reduce((sum, r) => sum + Number(r[3]), 0);
    expect(ledger).toBeCloseTo(15.8 * 4 * 40, 1);
    for (const f of readdirSync(join(root, 'experiments/output')).filter((f) => !before.has(f))) {
      rmSync(join(root, 'experiments/output', f), { recursive: true, force: true });
    }
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it('rejects a bad configuration with a clear message and no run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'folk-cli-bad-'));
    const config = join(dir, 'bad.json');
    writeFileSync(config, JSON.stringify({ species: { unicorn: { maxCapacity: 1 } } }));
    const result = run('main.ts', ['--config', config, '--ticks', '10', '--no-log']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('bad.json');
    expect(result.stderr).toContain('species.unicorn');
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});

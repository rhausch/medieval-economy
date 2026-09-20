import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
});

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  createSim,
  DECIDERS,
  resetPerf,
  summarize,
  type Settings,
  type TimingSummary,
} from '@folk/sim';
import { defaultOutputDir, loadSettings } from '@folk/runlog';

const { values } = parseArgs({
  options: {
    config: { type: 'string' },
    folk: { type: 'string', default: '20,100,500,2000' },
    deciders: { type: 'string', default: 'rules,utility,mixed' },
    size: { type: 'string', default: '256' },
    ticks: { type: 'string', default: '300' },
    warmup: { type: 'string', default: '100' },
    seed: { type: 'string', default: '1' },
    'ecology-interval': { type: 'string', default: '1' },
  },
});

let settings: Settings | undefined;
try {
  settings = values.config ? loadSettings(values.config) : undefined;
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
const folkCounts = values.folk.split(',').map(Number);
const modes = values.deciders.split(',');
const size = Number(values.size);
const ticks = Number(values.ticks);
const warmup = Number(values.warmup);
const seed = Number(values.seed);
const ecologyInterval = Number(values['ecology-interval']);

interface BenchRow {
  mode: string;
  folk: number;
  ticks: number;
  ticksPerSecond: number;
  msPerTick: number;
  ecologyMsPerTick: number;
  folkMsPerTick: number;
  /** Folk phase cost per Folk per tick, in microseconds. */
  folkMicrosPerFolkTick: number;
  decisionsPerTick: number;
  scan: TimingSummary;
  decide: Record<string, TimingSummary>;
}

function deciderKeys(mode: string): string[] {
  return mode === 'mixed' ? DECIDERS.map((d) => d.key) : [mode];
}

function bench(mode: string, folk: number): BenchRow {
  const sim = createSim({
    seed,
    settings,
    folkCount: folk,
    deciders: deciderKeys(mode),
    world: { width: size, height: size },
    ecologyInterval,
    timer: () => performance.now(),
  });
  for (let i = 0; i < warmup; i++) sim.step();
  sim.drainEvents();
  const perf = sim.perf!;
  resetPerf(perf);

  const start = performance.now();
  for (let i = 0; i < ticks; i++) {
    sim.step();
    sim.drainEvents();
  }
  const wallMs = performance.now() - start;

  const decisions = perf.decide.reduce((sum, s) => sum + s.count, 0);
  return {
    mode,
    folk,
    ticks,
    ticksPerSecond: (ticks * 1000) / wallMs,
    msPerTick: wallMs / ticks,
    ecologyMsPerTick: perf.ecology.totalMs / ticks,
    folkMsPerTick: perf.folk.totalMs / ticks,
    folkMicrosPerFolkTick: (perf.folk.totalMs * 1000) / (ticks * folk),
    decisionsPerTick: decisions / ticks,
    scan: summarize(perf.scan),
    decide: Object.fromEntries(
      DECIDERS.flatMap((d, i) =>
        perf.decide[i]!.count > 0 ? [[d.key, summarize(perf.decide[i]!)]] : [],
      ),
    ),
  };
}

const us = (ms: number): string => (ms * 1000).toFixed(1).padStart(7);
const pad = (v: string | number, n: number): string => String(v).padStart(n);

console.log(
  `benchmark: ${size}x${size} world, ${ticks} ticks after ${warmup} warm-up, seed ${seed}, ecology every ${ecologyInterval} tick(s)\n`,
);
console.log(
  `${pad('mode', 8)} ${pad('folk', 5)} ${pad('ticks/s', 8)} ${pad('ms/tick', 8)} ${pad('eco ms', 7)} ${pad('folk ms', 8)} ${pad('us/folk', 8)} ${pad('dec/tick', 9)} | ${pad('scan p50', 8)} ${pad('p95', 7)} ${pad('p99', 7)} | decide us p50 / p95 / p99 / max`,
);

const rows: BenchRow[] = [];
for (const mode of modes) {
  for (const folk of folkCounts) {
    const r = bench(mode, folk);
    rows.push(r);
    const decide = Object.entries(r.decide)
      .map(
        ([key, s]) =>
          `${key} ${us(s.p50Ms).trim()}/${us(s.p95Ms).trim()}/${us(s.p99Ms).trim()}/${us(s.maxMs).trim()}`,
      )
      .join('  ');
    console.log(
      `${pad(r.mode, 8)} ${pad(r.folk, 5)} ${pad(r.ticksPerSecond.toFixed(0), 8)} ${pad(r.msPerTick.toFixed(2), 8)} ${pad(r.ecologyMsPerTick.toFixed(2), 7)} ${pad(r.folkMsPerTick.toFixed(2), 8)} ${pad(r.folkMicrosPerFolkTick.toFixed(1), 8)} ${pad(r.decisionsPerTick.toFixed(1), 9)} | ${pad((r.scan.p50Ms * 1000).toFixed(1), 8)} ${us(r.scan.p95Ms)} ${us(r.scan.p99Ms)} | ${decide}`,
    );
  }
}

let commit: string | null = null;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  /* not a git checkout */
}
const dir = defaultOutputDir();
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = join(dir, `bench-${stamp}.json`);
writeFileSync(
  file,
  JSON.stringify(
    {
      when: new Date().toISOString(),
      commit,
      node: process.version,
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      settings: { size, ticks, warmup, seed, ecologyInterval, config: values.config ?? null },
      rows,
    },
    null,
    2,
  ),
);
console.log(`\nresults: ${file}`);

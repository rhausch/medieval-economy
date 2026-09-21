import { parseArgs } from 'node:util';
import {
  createSim,
  ledgerRows,
  activityRows,
  SPECIES_LIST,
  speciesTotals,
  type Settings,
} from '@folk/sim';
import { loadSettings, startRun } from '@folk/runlog';

const { values } = parseArgs({
  allowNegative: true,
  options: {
    config: { type: 'string' },
    seed: { type: 'string', default: '1' },
    ticks: { type: 'string', default: '1000' },
    folk: { type: 'string' },
    size: { type: 'string' },
    regrowth: { type: 'string' },
    deciders: { type: 'string' },
    'snapshot-interval': { type: 'string', default: '10' },
    'metrics-interval': { type: 'string', default: '100' },
    moves: { type: 'boolean', default: false },
    goals: { type: 'boolean', default: false },
    log: { type: 'boolean', default: true },
  },
});

let settings: Settings | undefined;
try {
  settings = values.config ? loadSettings(values.config) : undefined;
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const seed = Number(values.seed);
const ticks = Number(values.ticks);
const sim = createSim({
  seed,
  settings,
  ...(values.folk ? { folkCount: Number(values.folk) } : {}),
  ...(values.size ? { world: { width: Number(values.size), height: Number(values.size) } } : {}),
  ...(values.regrowth ? { plantRegrowthScale: Number(values.regrowth) } : {}),
  ...(values.deciders ? { deciders: values.deciders.split(',') } : {}),
  emitMoves: values.moves,
  emitGoals: values.goals,
  timer: () => performance.now(),
});

const logger = values.log
  ? startRun(sim, {
      snapshotInterval: Number(values['snapshot-interval']),
      metricsInterval: Number(values['metrics-interval']),
      configPath: values.config ?? null,
    })
  : null;
logger?.record(sim);

const counts: Record<string, number> = {};
const start = performance.now();
for (let i = 0; i < ticks; i++) {
  sim.step();
  const events = logger ? logger.record(sim) : sim.drainEvents();
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
}
const ms = performance.now() - start;
logger?.close(sim);

const totals = speciesTotals(sim.ecology);
const capacity = sim.settings.body.reserveCapacity;
const reserves = Array.from(sim.folk.reserve);
const mean = reserves.reduce((a, b) => a + b, 0) / reserves.length;
const ledger = ledgerRows(sim.metrics);
const kcal = (category: string): number =>
  ledger.filter((r) => r.category === category).reduce((sum, r) => sum + r.kcal, 0);
const activity = activityRows(sim.metrics).reduce((sum, r) => sum + r.kcal, 0);

console.log(
  `seed=${seed} ticks=${sim.tick} folk=${sim.folk.count} elapsed=${ms.toFixed(0)}ms${values.config ? ` config=${values.config}` : ''}`,
);
console.log(`events: ${JSON.stringify(counts)}`);
console.log(
  `reserve: mean ${((100 * mean) / capacity).toFixed(0)}% of capacity, lowest ${((100 * Math.min(...reserves)) / capacity).toFixed(0)}%`,
);
console.log(
  `calories: eaten ${Math.round(kcal('eaten'))}, burned ${Math.round(kcal('baseline') + activity + kcal('healing'))} (baseline ${Math.round(kcal('baseline'))}, activity ${Math.round(activity)}, healing ${Math.round(kcal('healing'))})`,
);
console.log(SPECIES_LIST.map((s, i) => `${s.key}=${Math.round(totals[i]!)}`).join(' '));
if (sim.perf) {
  const us = (v: number): string => (v * 1000).toFixed(1);
  console.log(
    `per tick: ${sim.perf.step.meanMs.toFixed(2)}ms (ecology ${sim.perf.ecology.meanMs.toFixed(2)}, folk ${sim.perf.folk.meanMs.toFixed(2)}); decisions: scan p50/p95 ${us(sim.perf.scan.quantileMs(0.5))}/${us(sim.perf.scan.quantileMs(0.95))}us`,
  );
}
if (logger) console.log(`log: ${logger.dir}`);

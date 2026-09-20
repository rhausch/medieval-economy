import { parseArgs } from 'node:util';
import { createSim, SPECIES_LIST, speciesTotals } from '@folk/sim';
import { startRun } from '@folk/runlog';

const { values } = parseArgs({
  allowNegative: true,
  options: {
    seed: { type: 'string', default: '1' },
    ticks: { type: 'string', default: '1000' },
    folk: { type: 'string' },
    size: { type: 'string' },
    'snapshot-interval': { type: 'string', default: '10' },
    moves: { type: 'boolean', default: false },
    log: { type: 'boolean', default: true },
  },
});

const seed = Number(values.seed);
const ticks = Number(values.ticks);
const sim = createSim({
  seed,
  ...(values.folk ? { folkCount: Number(values.folk) } : {}),
  ...(values.size ? { world: { width: Number(values.size), height: Number(values.size) } } : {}),
  emitMoves: values.moves,
});

const logger = values.log
  ? startRun(sim, {
      snapshotInterval: Number(values['snapshot-interval']),
      extra: { decider: 'rules' },
    })
  : null;
logger?.record(sim);

let deaths = 0;
let meals = 0;
const start = performance.now();
for (let i = 0; i < ticks; i++) {
  sim.step();
  const events = logger ? logger.record(sim) : sim.drainEvents();
  for (const e of events) {
    if (e.type === 'die') deaths++;
    else if (e.type === 'eat') meals++;
  }
}
const ms = performance.now() - start;
logger?.close(sim);

const totals = speciesTotals(sim.ecology);
console.log(`seed=${seed} ticks=${sim.tick} folk=${sim.folk.count} elapsed=${ms.toFixed(0)}ms`);
console.log(`deaths=${deaths} meals=${meals}`);
console.log(SPECIES_LIST.map((s, i) => `${s.key}=${Math.round(totals[i]!)}`).join(' '));
if (logger) console.log(`log: ${logger.dir}`);

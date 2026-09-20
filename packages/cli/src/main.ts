import { parseArgs } from 'node:util';
import { createSim } from '@folk/sim';

const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '1' },
    ticks: { type: 'string', default: '1000' },
  },
});

const seed = Number(values.seed);
const ticks = Number(values.ticks);
const sim = createSim({ seed });

const start = performance.now();
for (let i = 0; i < ticks; i++) sim.step();
const ms = performance.now() - start;

console.log(`seed=${seed} ticks=${sim.tick} elapsed=${ms.toFixed(1)}ms`);

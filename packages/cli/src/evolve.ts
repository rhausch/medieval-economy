import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  adjustCoverage,
  createRng,
  deciderByKey,
  defaultSettings,
  evaluateGeneration,
  nextGeneration,
  randomGenome,
  type Curriculum,
  type EvolutionOptions,
  type Settings,
} from '@folk/sim';
import { hashSettings, loadSettings } from '@folk/runlog';

const { values } = parseArgs({
  allowNegative: true,
  options: {
    config: { type: 'string' },
    decider: { type: 'string', default: 'utility' },
    seed: { type: 'string', default: '1' },
    folk: { type: 'string', default: '400' },
    size: { type: 'string', default: '512' },
    ticks: { type: 'string', default: '50000' },
    'stop-below': { type: 'string', default: '0.25' },
    generations: { type: 'string', default: '100' },
    'start-coverage': { type: 'string', default: '1' },
    target: { type: 'string', default: '0.5' },
    tolerance: { type: 'string', default: '0.05' },
    harder: { type: 'string', default: '0.92' },
    easier: { type: 'string', default: '1.04' },
    'min-coverage': { type: 'string', default: '0.02' },
    elite: { type: 'string', default: '0.05' },
    tournament: { type: 'string', default: '3' },
    'mutation-rate': { type: 'string', default: '0.2' },
    'mutation-scale': { type: 'string', default: '0.1' },
    resume: { type: 'string' },
    out: { type: 'string' },
  },
});

const cwd = process.env.INIT_CWD ?? process.cwd();
let settings: Settings;
try {
  settings = values.config ? loadSettings(values.config) : defaultSettings();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const decider = deciderByKey(values.decider!);
const specs = settings.deciders[settings.deciders.findIndex((d) => d.key === decider.key)]!.params;
const seed = Number(values.seed);
const folk = Number(values.folk);
const size = Number(values.size);
const ticks = Number(values.ticks);
const stopBelow = Number(values['stop-below']);
const generations = Number(values.generations);
const evolution: EvolutionOptions = {
  eliteFraction: Number(values.elite),
  tournamentSize: Number(values.tournament),
  mutationRate: Number(values['mutation-rate']),
  mutationScale: Number(values['mutation-scale']),
};
const curriculum: Curriculum = {
  targetSurvival: Number(values.target),
  tolerance: Number(values.tolerance),
  harder: Number(values.harder),
  easier: Number(values.easier),
  minCoverage: Number(values['min-coverage']),
  maxCoverage: 1,
};

interface Checkpoint {
  generation: number;
  coverage: number;
  population: number[][];
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
const dir = values.resume
  ? resolve(cwd, values.resume)
  : resolve(cwd, values.out ?? join('experiments/output', `${stamp}-evolve-${decider.key}`));
mkdirSync(dir, { recursive: true });

const rng = createRng(seed ^ 0x2545f491);
let generation = 0;
let coverage = Number(values['start-coverage']);
let population: number[][];
const checkpointPath = join(dir, 'checkpoint.json');
if (values.resume) {
  if (!existsSync(checkpointPath)) {
    console.error(`no checkpoint.json in ${dir}`);
    process.exit(1);
  }
  const saved = JSON.parse(readFileSync(checkpointPath, 'utf8')) as Checkpoint;
  ({ generation, coverage, population } = saved);
  // A resumed run continues the random stream from a fresh seed so breeding differs from the earlier run.
  for (let i = 0; i < generation * 10; i++) rng.next();
} else {
  population = Array.from({ length: folk }, () => randomGenome(specs, rng));
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify(
      {
        decider: decider.key,
        seed,
        folk,
        size,
        ticks,
        stopBelow,
        generations,
        startCoverage: coverage,
        evolution,
        curriculum,
        config: values.config ?? null,
        settingsHash: hashSettings(settings),
        params: specs.map((s) => s.key),
      },
      null,
      2,
    ) + '\n',
  );
  writeFileSync(
    join(dir, 'generations.csv'),
    [
      'generation,coverage,survivors,survival,ticks,stoppedEarly,meanFitness,bestFitness,seconds',
      ...specs.map((s) => `mean_${s.key}`),
      ...specs.map((s) => `best_${s.key}`),
    ].join(',') + '\n',
  );
}

console.log(
  `evolving ${decider.key}: ${folk} Folk, ${size}x${size} world, up to ${ticks} ticks, ` +
    `stop below ${stopBelow * 100}% alive, target ${curriculum.targetSurvival * 100}% survival; log ${dir}`,
);

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const end = generation + generations;
for (; generation < end; generation++) {
  const started = performance.now();
  const result = evaluateGeneration(population, {
    sim: {
      seed: seed + generation,
      settings,
      world: { width: size, height: size },
      coverageScale: coverage,
      deciders: [decider.key],
    },
    ticks,
    stopBelow,
  });
  const seconds = (performance.now() - started) / 1000;
  const survival = result.survivors / folk;
  const best = result.fitness.indexOf(Math.max(...result.fitness));
  const row = [
    generation,
    coverage.toFixed(4),
    result.survivors,
    survival.toFixed(4),
    result.ticks,
    result.stoppedEarly ? 1 : 0,
    mean(result.fitness).toFixed(1),
    result.fitness[best]!.toFixed(1),
    seconds.toFixed(1),
    ...specs.map((_, i) => mean(population.map((g) => g[i]!)).toFixed(4)),
    ...specs.map((_, i) => population[best]![i]!.toFixed(4)),
  ];
  appendFileSync(join(dir, 'generations.csv'), row.join(',') + '\n');
  writeFileSync(
    join(dir, 'best.json'),
    JSON.stringify(
      {
        generation,
        coverage,
        fitness: result.fitness[best],
        params: Object.fromEntries(specs.map((s, i) => [s.key, population[best]![i]])),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `gen ${generation}: coverage ${coverage.toFixed(3)} survival ${(survival * 100).toFixed(0)}% ` +
      `(${result.survivors}/${folk}) ticks ${result.ticks}${result.stoppedEarly ? ' (stopped early)' : ''} ` +
      `mean lifetime ${mean(result.lived).toFixed(0)} in ${seconds.toFixed(1)}s`,
  );
  coverage = adjustCoverage(coverage, survival, curriculum);
  population = nextGeneration(population, result.fitness, specs, rng, evolution);
  writeFileSync(
    checkpointPath,
    JSON.stringify({ generation: generation + 1, coverage, population } satisfies Checkpoint),
  );
}

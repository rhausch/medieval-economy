import type { ParamSpec } from './deciders/types';
import { createSim, type SimConfig } from './sim';
import { type Rng } from './rng';

/** How the next generation is bred from the last. */
export interface EvolutionOptions {
  /** Share of the population copied unchanged (the best ones). */
  eliteFraction: number;
  /** Parents are the best of this many random individuals. */
  tournamentSize: number;
  /** Chance that each parameter is changed in a child. */
  mutationRate: number;
  /** Size of a change, as a share of the parameter's range (one standard deviation). */
  mutationScale: number;
}

/** A random parameter array drawn evenly from each parameter's range. */
export function randomGenome(specs: readonly ParamSpec[], rng: Rng): number[] {
  return specs.map((spec) => spec.min + (spec.max - spec.min) * rng.next());
}

/** Roughly normal with standard deviation 1 (sum of four uniforms), using only basic arithmetic. */
function normal(rng: Rng): number {
  return (rng.next() + rng.next() + rng.next() + rng.next() - 2) * 1.7320508;
}

function tournament(fitness: readonly number[], size: number, rng: Rng): number {
  let best = Math.floor(rng.next() * fitness.length);
  for (let k = 1; k < size; k++) {
    const other = Math.floor(rng.next() * fitness.length);
    if (fitness[other]! > fitness[best]!) best = other;
  }
  return best;
}

/**
 * Breed the next generation: keep the elite, and fill the rest with children of tournament-picked parents
 * (each parameter taken from either parent, then perhaps nudged by a small random amount and kept in range).
 */
export function nextGeneration(
  genomes: readonly (readonly number[])[],
  fitness: readonly number[],
  specs: readonly ParamSpec[],
  rng: Rng,
  options: EvolutionOptions,
): number[][] {
  const order = fitness.map((_, i) => i).sort((a, b) => fitness[b]! - fitness[a]! || a - b);
  const elite = Math.min(genomes.length, Math.floor(genomes.length * options.eliteFraction));
  const next: number[][] = [];
  for (let i = 0; i < elite; i++) next.push([...genomes[order[i]!]!]);
  while (next.length < genomes.length) {
    const a = genomes[tournament(fitness, options.tournamentSize, rng)]!;
    const b = genomes[tournament(fitness, options.tournamentSize, rng)]!;
    next.push(
      specs.map((spec, i) => {
        let value = rng.next() < 0.5 ? a[i]! : b[i]!;
        if (rng.next() < options.mutationRate) {
          value += normal(rng) * options.mutationScale * (spec.max - spec.min);
        }
        return Math.min(spec.max, Math.max(spec.min, value));
      }),
    );
  }
  return next;
}

/** How food scarcity is steered from generation to generation. */
export interface Curriculum {
  /** The share of Folk that should still be alive at the end of a run. */
  targetSurvival: number;
  /** No change while survival is within this of the target. */
  tolerance: number;
  /** Multiply coverage by this when Folk do better than the target (less than 1). */
  harder: number;
  /** Multiply coverage by this when they do worse (more than 1). */
  easier: number;
  /** Coverage is kept between these. */
  minCoverage: number;
  maxCoverage: number;
}

/** The food coverage for the next generation: leaner when the Folk beat the target, richer when they miss it. */
export function adjustCoverage(coverage: number, survival: number, c: Curriculum): number {
  let next = coverage;
  if (survival > c.targetSurvival + c.tolerance) next = coverage * c.harder;
  else if (survival < c.targetSurvival - c.tolerance) next = coverage * c.easier;
  return Math.min(c.maxCoverage, Math.max(c.minCoverage, next));
}

export interface EvaluationOptions {
  /** The world and Folk settings for the run; `folkCount`, `genomes`, and `replaceDead` are set here. */
  sim: Omit<SimConfig, 'genomes' | 'folkCount' | 'replaceDead' | 'spawnRandom'>;
  /** The run ends after this many ticks. */
  ticks: number;
  /** The run ends early once fewer than this share of the Folk are alive. */
  stopBelow: number;
  /** Called every 1000 ticks with the tick and Folk alive (for progress output). */
  onProgress?: (tick: number, alive: number) => void;
}

export interface Evaluation {
  /** One score per genome: ticks lived, plus up to 1000 for the calorie reserve left by those still alive. */
  fitness: number[];
  /** Ticks each Folk lived. */
  lived: number[];
  /** How many Folk were alive when the run ended, and the tick it ended. */
  survivors: number;
  ticks: number;
  /** True if the run stopped early because too few were left. */
  stoppedEarly: boolean;
}

/**
 * Run one generation: every genome is one Folk, alone at a random place in a shared world, with no
 * replacement. The run lasts `ticks`, or stops early if the population falls below `stopBelow`.
 */
export function evaluateGeneration(
  genomes: readonly (readonly number[])[],
  options: EvaluationOptions,
): Evaluation {
  const sim = createSim({
    ...options.sim,
    folkCount: genomes.length,
    genomes,
    spawnRandom: true,
    replaceDead: false,
  });
  const stopAt = Math.ceil(options.stopBelow * genomes.length);
  let stoppedEarly = false;
  while (sim.tick < options.ticks) {
    sim.step();
    sim.drainEvents();
    if (sim.tick % 1000 === 0) options.onProgress?.(sim.tick, sim.aliveCount());
    if (sim.aliveCount() < stopAt) {
      stoppedEarly = true;
      break;
    }
  }
  const capacity = sim.settings.body.reserveCapacity;
  const lived = genomes.map((_, slot) => sim.folk.age[slot]!);
  const fitness = genomes.map(
    (_, slot) =>
      lived[slot]! + (sim.folk.alive[slot] ? (1000 * sim.folk.reserve[slot]!) / capacity : 0),
  );
  return { fitness, lived, survivors: sim.aliveCount(), ticks: sim.tick, stoppedEarly };
}

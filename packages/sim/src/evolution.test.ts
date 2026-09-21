import { describe, expect, it } from 'vitest';
import { deciderByKey } from './deciders';
import {
  adjustCoverage,
  evaluateGeneration,
  nextGeneration,
  randomGenome,
  type Curriculum,
  type EvolutionOptions,
} from './evolution';
import { createRng } from './rng';
import { createSim } from './sim';

const specs = deciderByKey('utility').params;
const options: EvolutionOptions = {
  eliteFraction: 0.1,
  tournamentSize: 3,
  mutationRate: 0.3,
  mutationScale: 0.1,
};
const world = { width: 64, height: 64, noiseScale: 24 };

describe('breeding', () => {
  const rng = createRng(1);
  const genomes = Array.from({ length: 40 }, () => randomGenome(specs, rng));

  it('random genomes are inside every parameter range', () => {
    for (const g of genomes) {
      specs.forEach((s, i) => {
        expect(g[i]).toBeGreaterThanOrEqual(s.min);
        expect(g[i]).toBeLessThanOrEqual(s.max);
      });
    }
  });

  it('keeps the population size and the best individuals, and stays in range', () => {
    const fitness = genomes.map((_, i) => i);
    const next = nextGeneration(genomes, fitness, specs, createRng(2), options);
    expect(next).toHaveLength(genomes.length);
    expect(next.slice(0, 4)).toEqual([genomes[39], genomes[38], genomes[37], genomes[36]]);
    for (const g of next) {
      specs.forEach((s, i) => {
        expect(g[i]).toBeGreaterThanOrEqual(s.min);
        expect(g[i]).toBeLessThanOrEqual(s.max);
      });
    }
  });

  it('is deterministic for a seed', () => {
    const fitness = genomes.map((_, i) => (i * 7) % 13);
    expect(nextGeneration(genomes, fitness, specs, createRng(5), options)).toEqual(
      nextGeneration(genomes, fitness, specs, createRng(5), options),
    );
  });

  it('moves the population towards the parameters that score well', () => {
    const rng2 = createRng(9);
    let pop = Array.from({ length: 60 }, () => randomGenome(specs, rng2));
    const mean = (g: number[][]): number => g.reduce((s, x) => s + x[0]!, 0) / g.length;
    const before = mean(pop);
    for (let gen = 0; gen < 15; gen++) {
      pop = nextGeneration(
        pop,
        pop.map((g) => g[0]!),
        specs,
        rng2,
        options,
      );
    }
    expect(mean(pop)).toBeGreaterThan(before);
    expect(mean(pop)).toBeGreaterThan(specs[0]!.min + 0.8 * (specs[0]!.max - specs[0]!.min));
  });
});

describe('curriculum', () => {
  const c: Curriculum = {
    targetSurvival: 0.5,
    tolerance: 0.05,
    harder: 0.9,
    easier: 1.05,
    minCoverage: 0.05,
    maxCoverage: 1,
  };
  it('lowers food when Folk beat the target, raises it when they miss, holds near it', () => {
    expect(adjustCoverage(1, 0.9, c)).toBeCloseTo(0.9);
    expect(adjustCoverage(0.5, 0.2, c)).toBeCloseTo(0.525);
    expect(adjustCoverage(0.5, 0.52, c)).toBe(0.5);
  });
  it('stays within its bounds', () => {
    expect(adjustCoverage(1, 0.1, c)).toBe(1);
    expect(adjustCoverage(0.05, 0.99, c)).toBe(0.05);
  });
});

describe('genomes in the sim', () => {
  it('give Folk exactly those parameters, clamped to range, and log them in spawn events', () => {
    const sim = createSim({
      seed: 3,
      world,
      folkCount: 3,
      deciders: ['utility'],
      genomes: [specs.map((s) => s.max + 100), specs.map((s) => s.min)],
    });
    const spawns = sim.drainEvents().filter((e) => e.type === 'spawn');
    expect(spawns[0]!.params).toEqual(specs.map((s) => Number(s.max.toFixed(4))));
    expect(spawns[1]!.params).toEqual(specs.map((s) => Number(s.min.toFixed(4))));
    // Genomes are handed out in turn.
    expect(spawns[2]!.params).toEqual(spawns[0]!.params);
  });
});

describe('evaluateGeneration', () => {
  const sim = { seed: 4, world, deciders: ['utility'], coverageScale: 1 };
  const genomes = Array.from({ length: 12 }, (_, i) => randomGenome(specs, createRng(i + 1)));

  it('scores every genome, is deterministic, and counts lifetimes', () => {
    const a = evaluateGeneration(genomes, { sim, ticks: 800, stopBelow: 0.25 });
    const b = evaluateGeneration(genomes, { sim, ticks: 800, stopBelow: 0.25 });
    expect(a).toEqual(b);
    expect(a.fitness).toHaveLength(12);
    expect(a.lived.every((l) => l > 0 && l <= 800)).toBe(true);
    expect(a.survivors).toBe(a.lived.filter((l) => l === 800).length);
    expect(a.stoppedEarly).toBe(false);
  });

  it('stops early when the population falls below the threshold, and the dead keep their lifetimes', () => {
    const barren = { ...sim, coverageScale: 0 };
    const r = evaluateGeneration(genomes, { sim: barren, ticks: 20000, stopBelow: 0.5 });
    expect(r.stoppedEarly).toBe(true);
    expect(r.ticks).toBeLessThan(20000);
    expect(r.survivors).toBeLessThan(6);
    expect(Math.min(...r.lived)).toBeLessThan(r.ticks);
  });

  it('scores survivors above the dead', () => {
    const r = evaluateGeneration(genomes, {
      sim: { ...sim, coverageScale: 0.1 },
      ticks: 6000,
      stopBelow: 0,
    });
    const alive = r.fitness.filter((_, i) => r.lived[i] === r.ticks);
    const dead = r.fitness.filter((_, i) => r.lived[i]! < r.ticks);
    if (alive.length && dead.length) expect(Math.min(...alive)).toBeGreaterThan(Math.max(...dead));
  });
});

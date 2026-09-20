import { describe, expect, it } from 'vitest';
import { SPECIES_LIST, type SpeciesDef } from '../data/species';
import { TERRAIN } from '../data/terrain';
import { createRng } from '../rng';
import { generateWorld } from '../world';
import { createEcology, speciesTotals, stepEcology } from './ecology';

const world = generateWorld({ seed: 3, width: 64, height: 48, noiseScale: 20 });
const keyIndex = (key: string): number => SPECIES_LIST.findIndex((s) => s.key === key);

function make(species: readonly SpeciesDef[] = SPECIES_LIST, seed = 1) {
  return createEcology(world, createRng(seed), species);
}

describe('createEcology', () => {
  it('is deterministic for the same seed', () => {
    expect(make().stock).toEqual(make().stock);
  });

  it('differs between seeds', () => {
    expect(make(SPECIES_LIST, 1).stock).not.toEqual(make(SPECIES_LIST, 2).stock);
  });

  it('has no capacity or stock on uninhabitable terrain', () => {
    const eco = make();
    eco.species.forEach((_, s) => {
      for (let i = 0; i < world.terrain.length; i++) {
        if (world.terrain[i] === TERRAIN.water.id || world.terrain[i] === TERRAIN.mountain.id) {
          expect(eco.capacity[s]![i]).toBe(0);
          expect(eco.stock[s]![i]).toBe(0);
        }
      }
    });
  });

  it('starts every tile at or below its capacity', () => {
    const eco = make();
    eco.species.forEach((_, s) => {
      for (let i = 0; i < world.terrain.length; i++) {
        expect(eco.stock[s]![i]).toBeLessThanOrEqual(eco.capacity[s]![i]! + 1e-4);
      }
    });
  });

  it('gives different suitability to different terrain for the same species', () => {
    const eco = make();
    const deer = keyIndex('deer');
    const capOf = (id: number): number =>
      Math.max(...Array.from(eco.capacity[deer]!).filter((_, i) => world.terrain[i] === id));
    expect(capOf(TERRAIN.forest.id)).toBeGreaterThan(capOf(TERRAIN.hills.id));
  });
});

describe('stepEcology', () => {
  it('is deterministic', () => {
    const a = make();
    const b = make();
    for (let i = 0; i < 50; i++) {
      stepEcology(world, a);
      stepEcology(world, b);
    }
    expect(a.stock).toEqual(b.stock);
  });

  it('keeps stocks finite, non-negative, and plants within capacity', () => {
    const eco = make();
    for (let t = 0; t < 200; t++) stepEcology(world, eco);
    eco.species.forEach((def, s) => {
      for (let i = 0; i < world.terrain.length; i++) {
        const v = eco.stock[s]![i]!;
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        if (def.kind === 'plant') expect(v).toBeLessThanOrEqual(eco.capacity[s]![i]! + 1e-3);
      }
    });
  });

  it('regrows a depleted plant toward capacity', () => {
    const berries = SPECIES_LIST.filter((s) => s.kind === 'plant').slice(0, 1);
    const eco = make(berries);
    eco.stock[0]!.fill(0);
    for (let t = 0; t < 400; t++) stepEcology(world, eco);
    const filled = speciesTotals(eco)[0]! / eco.capacity[0]!.reduce((a, b) => a + b, 0);
    expect(filled).toBeGreaterThan(0.9);
  });

  it('conserves total stock when spreading, with growth and grazing switched off', () => {
    const still = {
      ...SPECIES_LIST[1]!,
      growthRate: 0,
      seedRate: 0,
      diffusionRate: 0.1,
    } as SpeciesDef;
    const eco = make([still]);
    const before = speciesTotals(eco)[0]!;
    for (let t = 0; t < 100; t++) stepEcology(world, eco);
    expect(speciesTotals(eco)[0]!).toBeCloseTo(before, -1);
  });

  it('smooths density differences by spreading', () => {
    const still = {
      ...SPECIES_LIST[1]!,
      growthRate: 0,
      seedRate: 0,
      diffusionRate: 0.1,
    } as SpeciesDef;
    const eco = make([still]);
    const spread = (): number => {
      let sum = 0;
      for (let i = 0; i < world.terrain.length - 1; i++) {
        const ki = eco.capacity[0]![i]!;
        const kj = eco.capacity[0]![i + 1]!;
        if (ki > 0 && kj > 0) sum += Math.abs(eco.stock[0]![i]! / ki - eco.stock[0]![i + 1]! / kj);
      }
      return sum;
    };
    const before = spread();
    for (let t = 0; t < 100; t++) stepEcology(world, eco);
    expect(spread()).toBeLessThan(before * 0.5);
  });

  it('lets grazing draw down plants where animals live', () => {
    const grazed = make();
    const control = make(SPECIES_LIST.filter((s) => s.kind === 'plant'));
    for (let t = 0; t < 300; t++) {
      stepEcology(world, grazed);
      stepEcology(world, control);
    }
    const berries = keyIndex('berries');
    expect(speciesTotals(grazed)[berries]!).toBeLessThan(speciesTotals(control)[berries]!);
  });

  it('starves animals that have no food', () => {
    const eco = make();
    const hare = keyIndex('hare');
    const before = speciesTotals(eco)[hare]!;
    eco.stock[keyIndex('berries')]!.fill(0);
    eco.capacity[keyIndex('berries')]!.fill(0);
    for (let t = 0; t < 300; t++) stepEcology(world, eco);
    expect(speciesTotals(eco)[hare]!).toBeLessThan(before * 0.05);
  });

  it('settles into a living balance: no species goes extinct', () => {
    const eco = make();
    for (let t = 0; t < 1500; t++) stepEcology(world, eco);
    for (const total of speciesTotals(eco)) expect(total).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { FORAGE_KEY, SPECIES_LIST, type SpeciesDef } from '../data/species';
import { TERRAIN } from '../data/terrain';
import { terrainResources } from '../metrics';
import { createRng } from '../rng';
import { generateWorld } from '../world';
import { createEcology, speciesTotals, stepEcology, type Ecology } from './ecology';

const world = generateWorld({ seed: 3, width: 96, height: 80, noiseScale: 30 });
const n = world.terrain.length;
const index = (key: string): number => SPECIES_LIST.findIndex((s) => s.key === key);

/** The same species with the old fast rates (per fast tick), so dynamics show up in a few hundred steps. */
function fast(
  list: readonly SpeciesDef[] = SPECIES_LIST,
  extra: Partial<Record<string, object>> = {},
) {
  return list.map((d) => {
    const boost = 200;
    const base =
      d.kind === 'plant'
        ? { ...d, growthRate: d.growthRate * boost, seedRate: d.seedRate * boost }
        : {
            ...d,
            growthRate: d.growthRate * boost,
            starvationRate: d.starvationRate * boost,
            intake: d.intake * boost,
          };
    return { ...base, ...(extra[d.key] ?? {}) } as SpeciesDef;
  });
}

/** Fast species with the animals' appetite switched off, so a test sees the plants alone. */
const plantsAlone = (extra: Partial<Record<string, object>> = {}): SpeciesDef[] =>
  fast(
    SPECIES_LIST.map((d) => (d.kind === 'animal' ? { ...d, intake: 0 } : d)),
    extra,
  );

function make(
  species: readonly SpeciesDef[] = SPECIES_LIST,
  options: Parameters<typeof createEcology>[3] = {},
  seed = 1,
): Ecology {
  return createEcology(world, createRng(seed), species, { seed: 3, ...options });
}

const patchTiles = (eco: Ecology, key: string): number => eco.active[index(key)]!.length;

/** Tiles a species could live on before patches, from a coverage-1 ecology. */
function habitable(key: string): number {
  const dense = make(
    SPECIES_LIST.map((d) => ({ ...d, coverage: 1 })),
    { separateAnimalFood: true },
  );
  return dense.active[index(key)]!.length;
}

describe('patches', () => {
  it('cover the requested share of the tiles a species can live on', () => {
    const eco = make();
    for (const def of SPECIES_LIST) {
      if (def.key === FORAGE_KEY) continue;
      const share = patchTiles(eco, def.key) / habitable(def.key);
      expect(share, def.key).toBeGreaterThan(def.coverage * 0.85);
      expect(share, def.key).toBeLessThan(def.coverage * 1.15);
    }
  });

  it('scale with the coverage multiplier, up to everywhere', () => {
    const base = patchTiles(make(), 'berries');
    expect(patchTiles(make(SPECIES_LIST, { coverageScale: 2 }), 'berries')).toBeGreaterThan(
      base * 1.8,
    );
    expect(patchTiles(make(SPECIES_LIST, { coverageScale: 0.5 }), 'berries')).toBeLessThan(
      base * 0.6,
    );
    expect(patchTiles(make(SPECIES_LIST, { coverageScale: 1000 }), 'berries')).toBe(
      habitable('berries'),
    );
  });

  it('are clumps, not scatter: a patch tile mostly has patch neighbours', () => {
    const eco = make();
    const s = index('berries');
    const cap = eco.capacity[s]!;
    let withNeighbour = 0;
    let total = 0;
    for (const i of eco.active[s]!) {
      total++;
      const x = i % world.width;
      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < world.width - 1 ? i + 1 : -1,
        i - world.width,
        i + world.width,
      ];
      if (neighbours.some((j) => j >= 0 && j < n && cap[j]! > 0)) withNeighbour++;
    }
    // Scattered tiles at 4% coverage would have a patch neighbour about 15% of the time.
    expect(withNeighbour / total).toBeGreaterThan(0.7);
  });

  it('keep species apart: their patches are laid out independently', () => {
    const eco = make();
    const a = eco.capacity[index('berries')]!;
    const b = eco.capacity[index('roots')]!;
    let both = 0;
    for (let i = 0; i < n; i++) if (a[i]! > 0 && b[i]! > 0) both++;
    const expected = (patchTiles(eco, 'berries') * patchTiles(eco, 'roots')) / habitable('berries');
    // Independent fields overlap about as often as chance (with generous room for clumping).
    expect(both).toBeLessThan(Math.max(30, expected * 6));
    expect(both).toBeLessThan(patchTiles(eco, 'roots'));
  });

  it('are the same for the same seed and differ between seeds', () => {
    const a = make(SPECIES_LIST, { seed: 5 });
    const b = make(SPECIES_LIST, { seed: 5 });
    const c = make(SPECIES_LIST, { seed: 6 });
    expect(a.capacity).toEqual(b.capacity);
    expect(a.capacity[0]).not.toEqual(c.capacity[0]);
  });

  it('are richer in the core than at the edge, when richness varies', () => {
    const eco = make();
    const s = index('berries');
    const caps = Array.from(eco.active[s]!, (i) => eco.capacity[s]![i]!);
    expect(Math.max(...caps) / Math.min(...caps)).toBeGreaterThan(1.5);
    const flat = make(SPECIES_LIST.map((d) => ({ ...d, patchRichness: 0 })));
    // With no richness variation, capacity differs only through terrain and moisture, not through position in a patch.
    const patchOnly = flat.capacity[s]!;
    const dense = make(
      SPECIES_LIST.map((d) => ({ ...d, coverage: 1 })),
      { separateAnimalFood: true },
    ).capacity[s]!;
    for (const i of flat.active[s]!) expect(patchOnly[i]).toBeCloseTo(dense[i]!, 3);
  });

  it('hold nothing outside them, and start within the configured share of capacity', () => {
    const eco = make(SPECIES_LIST, { initialFill: { min: 0.4, max: 0.6 } });
    eco.species.forEach((_, s) => {
      for (let i = 0; i < n; i++) {
        const cap = eco.capacity[s]![i]!;
        const stock = eco.stock[s]![i]!;
        if (cap === 0) expect(stock).toBe(0);
        else {
          expect(stock).toBeGreaterThanOrEqual(0.4 * cap - 1e-3);
          expect(stock).toBeLessThanOrEqual(0.6 * cap + 1e-3);
        }
      }
    });
  });

  it('never put anything on water or mountains', () => {
    const eco = make(SPECIES_LIST, { separateAnimalFood: true });
    eco.species.forEach((_, s) => {
      for (const i of eco.active[s]!) {
        expect([TERRAIN.water.id, TERRAIN.mountain.id]).not.toContain(world.terrain[i]);
      }
    });
  });

  it('leave the forage layer off unless animals graze it, and then only under the animals', () => {
    expect(patchTiles(make(), FORAGE_KEY)).toBe(0);
    const eco = make(SPECIES_LIST, { separateAnimalFood: true });
    const forage = eco.capacity[index(FORAGE_KEY)]!;
    const animals = ['hare', 'deer'].map((k) => eco.capacity[index(k)]!);
    let underAnimals = 0;
    for (let i = 0; i < n; i++) {
      const grazed = animals.some((a) => a[i]! > 0);
      if (grazed) underAnimals++;
      // Forage is where animals are, except tiles where the grass itself cannot grow.
      if (forage[i]! > 0) expect(grazed).toBe(true);
    }
    expect(patchTiles(eco, FORAGE_KEY)).toBeGreaterThan(underAnimals * 0.7);
    expect(patchTiles(eco, FORAGE_KEY)).toBeLessThan(n * 0.2);
  });
});

describe('the sparse layout', () => {
  it('lists exactly the tiles a species lives on, and the neighbouring pairs among them', () => {
    const eco = make();
    eco.species.forEach((_, s) => {
      const cap = eco.capacity[s]!;
      expect(Array.from(eco.active[s]!)).toEqual(
        Array.from({ length: n }, (_, i) => i).filter((i) => cap[i]! > 0),
      );
      const from = eco.edgeFrom[s]!;
      const to = eco.edgeTo[s]!;
      for (let e = 0; e < from.length; e++) {
        expect(cap[from[e]!]!).toBeGreaterThan(0);
        expect(cap[to[e]!]!).toBeGreaterThan(0);
        const d = to[e]! - from[e]!;
        expect(d === 1 || d === world.width).toBe(true);
      }
    });
  });

  it('only ever changes stock on the tiles a species lives on', () => {
    const eco = make(fast(), { separateAnimalFood: true });
    for (let t = 0; t < 200; t++) stepEcology(world, eco);
    eco.species.forEach((_, s) => {
      for (let i = 0; i < n; i++) if (eco.capacity[s]![i] === 0) expect(eco.stock[s]![i]).toBe(0);
    });
  });

  it('matches a plain whole-map implementation of the same rules', () => {
    // Dense species (coverage 1, no viability) so the reference can ignore patches entirely.
    const species = fast(
      SPECIES_LIST.map((d) => ({ ...d, coverage: 1, viability: 0, seedRate: d.seedRate })),
      {},
    );
    const eco = make(species, { separateAnimalFood: true });
    const stock = eco.stock.map((s) => Float32Array.from(s));
    const cap = eco.capacity;
    const diet = eco.dietIndices;
    const stepReference = (): void => {
      species.forEach((d, s) => {
        if (d.kind !== 'animal') return;
        for (let i = 0; i < n; i++) {
          const a = stock[s]![i]!;
          if (a === 0 || cap[s]![i]! === 0) continue;
          const k = cap[s]![i]!;
          const demand = a * d.intake;
          let food = 0;
          for (const p of diet[s]!) food += stock[p]![i]!;
          const eaten = Math.min(food, demand);
          if (eaten > 0) for (const p of diet[s]!) stock[p]![i]! -= (eaten * stock[p]![i]!) / food;
          const sat = demand > 0 ? eaten / demand : 1;
          const next = a + d.growthRate * a * (1 - a / k) * sat - d.starvationRate * a * (1 - sat);
          stock[s]![i] = next < 1e-4 ? 0 : next;
        }
      });
      species.forEach((d, s) => {
        if (d.kind !== 'plant') return;
        for (let i = 0; i < n; i++) {
          const k = cap[s]![i]!;
          if (k === 0) continue;
          const p = stock[s]![i]!;
          const next = p + d.growthRate * p * (1 - p / k) + d.seedRate * (k - p);
          stock[s]![i] = next < 0 ? 0 : next > k ? k : next;
        }
      });
      species.forEach((d, s) => {
        const delta = new Float32Array(n);
        const dd = Math.min(d.diffusionRate, 0.2);
        const edge = (i: number, j: number): void => {
          const ki = cap[s]![i]!;
          const kj = cap[s]![j]!;
          if (ki === 0 || kj === 0) return;
          const flow = dd * (stock[s]![i]! / ki - stock[s]![j]! / kj) * Math.min(ki, kj);
          delta[i]! -= flow;
          delta[j]! += flow;
        };
        for (let y = 0; y < world.height; y++) {
          for (let x = 0; x < world.width; x++) {
            const i = y * world.width + x;
            if (x + 1 < world.width) edge(i, i + 1);
            if (y + 1 < world.height) edge(i, i + world.width);
          }
        }
        for (let i = 0; i < n; i++) {
          if (cap[s]![i]! === 0) continue;
          const next = stock[s]![i]! + delta[i]!;
          stock[s]![i] = next < 1e-4 ? 0 : next;
        }
      });
    };
    for (let t = 0; t < 40; t++) {
      stepEcology(world, eco);
      stepReference();
    }
    species.forEach((_, s) => {
      for (let i = 0; i < n; i++) expect(eco.stock[s]![i]!).toBeCloseTo(stock[s]![i]!, 3);
    });
  });

  it('is deterministic', () => {
    const a = make(fast());
    const b = make(fast());
    for (let t = 0; t < 100; t++) {
      stepEcology(world, a);
      stepEcology(world, b);
    }
    expect(a.stock).toEqual(b.stock);
  });

  it('gives nearly the same result in one long step as in many short ones', () => {
    const one = make(SPECIES_LIST, { separateAnimalFood: true });
    const many = make(SPECIES_LIST, { separateAnimalFood: true });
    stepEcology(world, one, 10);
    for (let t = 0; t < 10; t++) stepEcology(world, many, 1);
    const a = speciesTotals(one);
    const b = speciesTotals(many);
    a.forEach((total, s) => {
      if (total > 0) expect(Math.abs(total - b[s]!) / total).toBeLessThan(0.01);
    });
  });
});

describe('plants', () => {
  it('regrow from a viable stock toward capacity', () => {
    const eco = make(plantsAlone(), { coverageScale: 1000 });
    const s = index('berries');
    for (const i of eco.active[s]!) eco.stock[s]![i] = 0.3 * eco.capacity[s]![i]!;
    for (let t = 0; t < 600; t++) stepEcology(world, eco);
    for (const i of eco.active[s]!)
      expect(eco.stock[s]![i]!).toBeGreaterThan(0.9 * eco.capacity[s]![i]!);
  });

  it('cannot grow back on their own below the viability level, with no seeding', () => {
    const eco = make(plantsAlone({ berries: { diffusionRate: 0 } }), {
      coverageScale: 1000,
    });
    const s = index('berries');
    const viability = eco.species[s]!.viability;
    expect(viability).toBeGreaterThan(0);
    for (const i of eco.active[s]!) eco.stock[s]![i] = 0.5 * viability * eco.capacity[s]![i]!;
    const before = Array.from(eco.active[s]!, (i) => eco.stock[s]![i]!);
    for (let t = 0; t < 300; t++) stepEcology(world, eco);
    Array.from(eco.active[s]!).forEach((i, k) =>
      expect(eco.stock[s]![i]!).toBeCloseTo(before[k]!, 4),
    );
  });

  it('leave a grazed-out patch empty for good, unless a neighbour seeds it', () => {
    const eco = make(plantsAlone(), { coverageScale: 1000 });
    const s = index('roots');
    // Empty a whole tile and its neighbours: nothing can bring it back.
    const centre = eco.active[s]![Math.floor(eco.active[s]!.length / 2)]!;
    const neighbourhood = [
      centre,
      centre - 1,
      centre + 1,
      centre - world.width,
      centre + world.width,
    ];
    for (const i of neighbourhood) if (eco.capacity[s]![i]! > 0) eco.stock[s]![i] = 0;
    // A tile with all-empty neighbours stays empty; its outer neighbours are still stocked and spread inward.
    for (let t = 0; t < 400; t++) stepEcology(world, eco);
    // The empty tile is refilled from the stocked ring around it (diffusion), then regrows.
    expect(eco.stock[s]![centre]!).toBeGreaterThan(0.5 * eco.capacity[s]![centre]!);
  });

  it('stay empty when every tile around is empty too', () => {
    const eco = make(plantsAlone(), { coverageScale: 1000 });
    const s = index('roots');
    eco.stock[s]!.fill(0);
    for (let t = 0; t < 300; t++) stepEcology(world, eco);
    expect(speciesTotals(eco)[s]).toBe(0);
  });

  it('spread into an emptied neighbour, which then regrows', () => {
    const eco = make(plantsAlone(), { coverageScale: 1000 });
    const s = index('berries');
    // A pair of neighbouring tiles: one full, one empty.
    const from = eco.edgeFrom[s]![1000]!;
    const to = eco.edgeTo[s]![1000]!;
    eco.stock[s]![from] = eco.capacity[s]![from]!;
    eco.stock[s]![to] = 0;
    stepEcology(world, eco);
    expect(eco.stock[s]![to]!).toBeGreaterThan(0);
  });

  it('conserve the total when only spreading', () => {
    // Animals switched off, so nothing eats the roots: they only spread.
    const eco = make(plantsAlone({ roots: { growthRate: 0, seedRate: 0, diffusionRate: 0.1 } }));
    const s = index('roots');
    const before = speciesTotals(eco)[s]!;
    for (let t = 0; t < 100; t++) stepEcology(world, eco);
    expect(speciesTotals(eco)[s]!).toBeCloseTo(before, -1);
  });
});

describe('animals', () => {
  it('graze the plants in their diet where they live, in shared mode', () => {
    const grazed = make(fast());
    const control = make(
      fast(SPECIES_LIST.map((d) => (d.kind === 'animal' ? { ...d, intake: 0 } : d))),
    );
    for (let t = 0; t < 300; t++) {
      stepEcology(world, grazed);
      stepEcology(world, control);
    }
    const s = index('berries');
    expect(speciesTotals(grazed)[s]!).toBeLessThan(speciesTotals(control)[s]!);
  });

  it('leave the berries alone and graze forage instead, when animal food is separate', () => {
    const shared = make(fast());
    const separate = make(fast(), { separateAnimalFood: true });
    const noAnimals = make(
      fast(SPECIES_LIST.map((d) => (d.kind === 'animal' ? { ...d, intake: 0 } : d))),
    );
    for (let t = 0; t < 300; t++) {
      stepEcology(world, shared);
      stepEcology(world, separate);
      stepEcology(world, noAnimals);
    }
    const berries = index('berries');
    // Separate animals never touch the berries: the berries evolve as if there were no animals at all.
    expect(speciesTotals(separate)[berries]!).toBeCloseTo(speciesTotals(noAnimals)[berries]!, 0);
    expect(speciesTotals(shared)[berries]!).toBeLessThan(speciesTotals(separate)[berries]!);
  });

  it('starve without food', () => {
    // The plants they eat neither grow nor regrow, and none is left.
    const eco = make(
      fast(SPECIES_LIST, {
        berries: { growthRate: 0, seedRate: 0 },
        roots: { growthRate: 0, seedRate: 0 },
      }),
    );
    eco.stock[index('berries')]!.fill(0);
    eco.stock[index('roots')]!.fill(0);
    const before = speciesTotals(eco)[index('hare')]!;
    expect(before).toBeGreaterThan(0);
    for (let t = 0; t < 400; t++) stepEcology(world, eco);
    expect(speciesTotals(eco)[index('hare')]!).toBeLessThan(before * 0.05);
  });

  it('lose most of a shared-diet population where their food is sparse, but not with separate forage', () => {
    // Hare live on 8% of tiles and berries on 4%, laid out independently: most hare have no berries.
    const shared = make(fast());
    const separate = make(fast(), { separateAnimalFood: true });
    for (let t = 0; t < 600; t++) {
      stepEcology(world, shared);
      stepEcology(world, separate);
    }
    const hare = index('hare');
    const total = (e: Ecology): number => speciesTotals(e)[hare]!;
    const cap = shared.capacity[hare]!.reduce((a, b) => a + b, 0);
    expect(total(shared) / cap).toBeLessThan(0.3);
    expect(total(separate) / cap).toBeGreaterThan(0.7);
  });
});

describe('patch reports', () => {
  it('count the patch tiles that have been grazed out', () => {
    const eco = make(SPECIES_LIST, { coverageScale: 1000 });
    const s = index('berries');
    const rows = () => terrainResources(world, eco).filter((r) => r.species === 'berries');
    const total = rows().reduce((sum, r) => sum + r.habitable, 0);
    expect(rows().reduce((sum, r) => sum + r.depleted, 0)).toBeLessThan(total * 0.15);
    for (const i of eco.active[s]!) eco.stock[s]![i] = 0;
    expect(rows().reduce((sum, r) => sum + r.depleted, 0)).toBe(total);
  });
});

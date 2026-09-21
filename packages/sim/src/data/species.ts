import type { TERRAIN } from './terrain';

/**
 * Species table. Plants and animals are per-tile stocks, not entities.
 * Plant stock is in kg per tile; animal stock is in head (fractional).
 *
 * Rates are per tick, and a tick is 6 minutes, so they are small: a berry patch takes days to weeks to
 * regrow and a herd months to recover. Food is sparse: each species lives only in patches that cover
 * `coverage` of the tiles it could live on at all.
 */
interface SpeciesBase {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  /** Marker color (0xRRGGBB) for overlays and tile sprites. */
  readonly color: number;
  /** Stock a tile holds at perfect suitability, in the richest part of a patch. */
  readonly maxCapacity: number;
  /** Habitat suitability 0..1 per terrain; missing means uninhabitable. */
  readonly terrainAffinity: Partial<Record<keyof typeof TERRAIN, number>>;
  /** Suitability falls linearly to 0 at `tolerance` away from `optimum` moisture (0..1). */
  readonly moisture: { readonly optimum: number; readonly tolerance: number };
  /** Share of the habitable tiles that are inside a patch (1 = everywhere it can live). */
  readonly coverage: number;
  /** Feature size of patches, in tiles: larger means bigger, farther-apart clumps. */
  readonly patchScale: number;
  /** How much richness varies inside a patch: 0 is uniform, 1 runs from empty edges to a rich core. */
  readonly patchRichness: number;
  /**
   * Below this share of a tile's capacity a plant cannot grow back on its own (0 disables it). With no
   * seeding either, a patch grazed below it recovers only from neighbouring stock.
   */
  readonly viability: number;
  /** Logistic growth rate per tick. */
  readonly growthRate: number;
  /** Fraction of the gap to capacity that regrows from nothing each tick (a seed bank). */
  readonly seedRate: number;
  /** Spread toward equal density between neighbours, per tick; keep at or below 0.2. */
  readonly diffusionRate: number;
}

export interface PlantDef extends SpeciesBase {
  readonly kind: 'plant';
}

export interface AnimalDef extends SpeciesBase {
  readonly kind: 'animal';
  /** Keys of plant species eaten, shared in proportion to availability. */
  readonly diet: readonly string[];
  /** Food kg eaten per head per tick when food is plentiful. */
  readonly intake: number;
  /** Fraction of the herd lost per tick when completely unfed. */
  readonly starvationRate: number;
}

export type SpeciesDef = PlantDef | AnimalDef;

/** The species animals graze when animal food is separate from Folk food (`ecology.separateAnimalFood`). */
export const FORAGE_KEY = 'forage';

export const SPECIES_LIST: readonly SpeciesDef[] = [
  {
    id: 0,
    key: 'berries',
    name: 'Berries',
    kind: 'plant',
    color: 0xb04a9c,
    maxCapacity: 100,
    terrainAffinity: { forest: 0.9, grass: 0.6, hills: 0.3, sand: 0.05 },
    moisture: { optimum: 0.6, tolerance: 0.9 },
    coverage: 0.04,
    patchScale: 5,
    patchRichness: 0.5,
    viability: 0.02,
    growthRate: 0.0006,
    seedRate: 0,
    diffusionRate: 0.004,
  },
  {
    id: 1,
    key: 'roots',
    name: 'Roots and nuts',
    kind: 'plant',
    color: 0xd98a3d,
    maxCapacity: 150,
    terrainAffinity: { forest: 1, hills: 0.6, grass: 0.4 },
    moisture: { optimum: 0.5, tolerance: 1 },
    coverage: 0.03,
    patchScale: 6,
    patchRichness: 0.5,
    viability: 0.02,
    growthRate: 0.0002,
    seedRate: 0,
    diffusionRate: 0.001,
  },
  {
    id: 2,
    key: 'hare',
    name: 'Hare',
    kind: 'animal',
    color: 0xf2f2f2,
    maxCapacity: 10,
    terrainAffinity: { grass: 1, forest: 0.5, hills: 0.4, sand: 0.1 },
    moisture: { optimum: 0.5, tolerance: 1 },
    coverage: 0.08,
    patchScale: 10,
    patchRichness: 0.5,
    viability: 0,
    growthRate: 0.00075,
    seedRate: 0,
    diffusionRate: 0.01,
    diet: ['berries'],
    intake: 0.00075,
    starvationRate: 0.0005,
  },
  {
    id: 3,
    key: 'deer',
    name: 'Deer',
    kind: 'animal',
    color: 0x5a3a20,
    maxCapacity: 4,
    terrainAffinity: { forest: 1, grass: 0.6, hills: 0.5 },
    moisture: { optimum: 0.5, tolerance: 1 },
    coverage: 0.02,
    patchScale: 24,
    patchRichness: 0.5,
    viability: 0,
    growthRate: 0.00025,
    seedRate: 0,
    diffusionRate: 0.01,
    diet: ['berries', 'roots'],
    intake: 0.0025,
    starvationRate: 0.0002,
  },
  {
    id: 4,
    key: FORAGE_KEY,
    name: 'Grass and browse',
    kind: 'plant',
    color: 0x9cc36b,
    maxCapacity: 300,
    terrainAffinity: { grass: 1, forest: 0.6, hills: 0.5, sand: 0.1 },
    moisture: { optimum: 0.5, tolerance: 1 },
    coverage: 1,
    patchScale: 10,
    patchRichness: 0.3,
    viability: 0,
    growthRate: 0.0008,
    seedRate: 0.00002,
    diffusionRate: 0.001,
  },
];

import type { TERRAIN } from './terrain';

/**
 * Species table. Plants and animals are per-tile stocks, not entities.
 * Plant stock is in food units; animal stock is in head (fractional).
 * All rates are per ecology step.
 */
interface SpeciesBase {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  /** Marker color (0xRRGGBB) for overlays and tile sprites. */
  readonly color: number;
  /** Stock a tile holds at perfect suitability. */
  readonly maxCapacity: number;
  /** Habitat suitability 0..1 per terrain; missing means uninhabitable. */
  readonly terrainAffinity: Partial<Record<keyof typeof TERRAIN, number>>;
  /** Suitability falls linearly to 0 at `tolerance` away from `optimum` moisture (0..1). */
  readonly moisture: { readonly optimum: number; readonly tolerance: number };
  /** Logistic growth rate. */
  readonly growthRate: number;
  /** Fraction of the gap to capacity that regrows from nothing each step (seed bank). */
  readonly seedRate: number;
  /** Spread toward equal density between neighbours; keep at or below 0.2. */
  readonly diffusionRate: number;
}

export interface PlantDef extends SpeciesBase {
  readonly kind: 'plant';
}

export interface AnimalDef extends SpeciesBase {
  readonly kind: 'animal';
  /** Keys of plant species eaten, shared in proportion to availability. */
  readonly diet: readonly string[];
  /** Food units eaten per head per step when food is plentiful. */
  readonly intake: number;
  /** Fraction of the herd lost per step when completely unfed. */
  readonly starvationRate: number;
}

export type SpeciesDef = PlantDef | AnimalDef;

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
    growthRate: 0.08,
    seedRate: 0.01,
    diffusionRate: 0.02,
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
    growthRate: 0.03,
    seedRate: 0.003,
    diffusionRate: 0.005,
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
    growthRate: 0.15,
    seedRate: 0,
    diffusionRate: 0.08,
    diet: ['berries'],
    intake: 0.15,
    starvationRate: 0.1,
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
    growthRate: 0.05,
    seedRate: 0,
    diffusionRate: 0.1,
    diet: ['berries', 'roots'],
    intake: 0.5,
    starvationRate: 0.04,
  },
];

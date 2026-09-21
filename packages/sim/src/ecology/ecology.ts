import { FORAGE_KEY, SPECIES_LIST, type AnimalDef, type SpeciesDef } from '../data/species';
import { TERRAIN_LIST } from '../data/terrain';
import type { Rng } from '../rng';
import type { World } from '../world';
import { patchFactors } from './patches';

/** Stock below this is treated as extinct on that tile. */
const EXTINCT_BELOW = 1e-4;
/** Diffusion per step is capped here so it stays stable however long a step is. */
const MAX_DIFFUSION = 0.2;

export interface EcologyOptions {
  /** Seeds the patch layout (normally the world seed). */
  seed?: number;
  /** Multiplies every species' coverage: above 1 for more food, below 1 for less. */
  coverageScale?: number;
  /** Animals graze their own forage instead of the berries and roots Folk gather. */
  separateAnimalFood?: boolean;
  /** Each tile starts at a random share of its capacity between these. */
  initialFill?: { min: number; max: number };
}

export interface Ecology {
  readonly species: readonly SpeciesDef[];
  /** Per species, per tile: the most stock the tile can hold (0 = the species is not there). */
  readonly capacity: readonly Float32Array[];
  /** Per species, per tile: current stock. */
  readonly stock: readonly Float32Array[];
  /** Per species: the tiles it lives on (capacity above 0). Only these are ever updated. */
  readonly active: readonly Int32Array[];
  /** Per species: pairs of neighbouring active tiles, stock spreads along these. */
  readonly edgeFrom: readonly Int32Array[];
  readonly edgeTo: readonly Int32Array[];
  /** Scratch buffer for diffusion. */
  readonly scratch: Float32Array;
  /** For animals: indices of the plant species they eat. */
  readonly dietIndices: readonly (readonly number[])[];
}

/** Suitability of every tile for a species from terrain and moisture alone (before patches). */
function habitatCapacity(def: SpeciesDef, world: World): Float32Array {
  const affinity = new Float32Array(TERRAIN_LIST.length);
  for (const t of TERRAIN_LIST) {
    affinity[t.id] = def.terrainAffinity[t.key as keyof typeof def.terrainAffinity] ?? 0;
  }
  const out = new Float32Array(world.terrain.length);
  for (let i = 0; i < out.length; i++) {
    const a = affinity[world.terrain[i]!]!;
    if (a === 0) continue;
    const m = 1 - Math.abs(world.moisture[i]! - def.moisture.optimum) / def.moisture.tolerance;
    out[i] = m > 0 ? def.maxCapacity * a * m : 0;
  }
  return out;
}

/**
 * Slow (or speed up) the whole plant-and-animal system: plants regrow at `scale` times the rate and
 * animals eat `scale` times as much, so the balance between them holds while plant supply shrinks
 * relative to what Folk need. A stand-in for seasons.
 */
export function scaleRegrowth(species: readonly SpeciesDef[], scale: number): SpeciesDef[] {
  if (scale === 1) return [...species];
  return species.map((def) =>
    def.kind === 'plant'
      ? { ...def, growthRate: def.growthRate * scale, seedRate: def.seedRate * scale }
      : { ...def, intake: def.intake * scale },
  );
}

/** Tiles where the species lives, and the pairs of neighbouring ones along which it spreads. */
function layout(cap: Float32Array, width: number, height: number) {
  const active: number[] = [];
  const from: number[] = [];
  const to: number[] = [];
  for (let i = 0; i < cap.length; i++) {
    if (cap[i]! <= 0) continue;
    active.push(i);
    const x = i % width;
    const y = (i - x) / width;
    if (x + 1 < width && cap[i + 1]! > 0) {
      from.push(i);
      to.push(i + 1);
    }
    if (y + 1 < height && cap[i + width]! > 0) {
      from.push(i);
      to.push(i + width);
    }
  }
  return {
    active: Int32Array.from(active),
    from: Int32Array.from(from),
    to: Int32Array.from(to),
  };
}

/**
 * Build the species' patches from terrain, moisture and each species' own noise field, and start every
 * patch tile at a random share of its capacity. Nothing exists outside a species' patches.
 */
export function createEcology(
  world: World,
  rng: Rng,
  species: readonly SpeciesDef[] = SPECIES_LIST,
  options: EcologyOptions = {},
): Ecology {
  const { seed = 0, coverageScale = 1, separateAnimalFood = false, initialFill } = options;
  const fill = initialFill ?? { min: 0, max: 1 };
  const capacity = species.map((def) => {
    // The forage layer only exists when animals graze it, and is filled in below.
    if (def.key === FORAGE_KEY) return new Float32Array(world.terrain.length);
    const base = habitatCapacity(def, world);
    const factor = patchFactors(world, def, base, seed, coverageScale);
    for (let i = 0; i < base.length; i++) base[i] = base[i]! * factor[i]!;
    return base;
  });
  const forageAt = species.findIndex((d) => d.key === FORAGE_KEY);
  if (separateAnimalFood && forageAt >= 0) {
    // Grass and browse grow only where an animal lives: nobody else eats it, so it is not worth simulating
    // elsewhere. This keeps the layer small however big the world is.
    const grazed = new Uint8Array(world.terrain.length);
    species.forEach((def, s) => {
      if (def.kind !== 'animal') return;
      for (let i = 0; i < grazed.length; i++) if (capacity[s]![i]! > 0) grazed[i] = 1;
    });
    const forage = habitatCapacity(species[forageAt]!, world);
    for (let i = 0; i < forage.length; i++) capacity[forageAt]![i] = grazed[i] ? forage[i]! : 0;
  }
  const stock = capacity.map((cap) => {
    const s = new Float32Array(cap.length);
    for (let i = 0; i < s.length; i++) {
      if (cap[i]! > 0) s[i] = cap[i]! * (fill.min + rng.next() * (fill.max - fill.min));
    }
    return s;
  });
  const keyToIndex = new Map(species.map((d, i) => [d.key, i]));
  const dietIndices = species.map((def) => {
    if (def.kind !== 'animal') return [];
    const diet = separateAnimalFood && keyToIndex.has(FORAGE_KEY) ? [FORAGE_KEY] : def.diet;
    return diet.map((key) => {
      const idx = keyToIndex.get(key);
      if (idx === undefined) throw new Error(`${def.key} eats unknown species ${key}`);
      return idx;
    });
  });
  const layouts = capacity.map((cap) => layout(cap, world.width, world.height));
  return {
    species,
    capacity,
    stock,
    active: layouts.map((l) => l.active),
    edgeFrom: layouts.map((l) => l.from),
    edgeTo: layouts.map((l) => l.to),
    scratch: new Float32Array(world.terrain.length),
    dietIndices,
  };
}

/** Animals graze their diet, then grow when fed and shrink when hungry. `dt` is the ticks this step covers. */
function stepAnimal(eco: Ecology, s: number, def: AnimalDef, dt: number): void {
  const stock = eco.stock[s]!;
  const cap = eco.capacity[s]!;
  const diet = eco.dietIndices[s]!.map((p) => eco.stock[p]!);
  for (const i of eco.active[s]!) {
    const a = stock[i]!;
    if (a === 0) continue;
    const k = cap[i]!;
    const demand = a * def.intake * dt;
    let food = 0;
    for (const plant of diet) food += plant[i]!;
    const eaten = Math.min(food, demand);
    if (eaten > 0) for (const plant of diet) plant[i]! -= (eaten * plant[i]!) / food;
    const satisfaction = demand > 0 ? eaten / demand : 1;
    const growth =
      (def.growthRate * a * (1 - a / k) * satisfaction -
        def.starvationRate * a * (1 - satisfaction)) *
      dt;
    const next = a + growth;
    stock[i] = next < EXTINCT_BELOW ? 0 : next;
  }
}

/**
 * Plants regrow logistically from current stock. Below the species' viability level they cannot grow on
 * their own; a seed bank (if any) and neighbouring stock are then the only ways back.
 */
function stepPlant(eco: Ecology, s: number, def: SpeciesDef, dt: number): void {
  const stock = eco.stock[s]!;
  const cap = eco.capacity[s]!;
  for (const i of eco.active[s]!) {
    const k = cap[i]!;
    const p = stock[i]!;
    const growth = p >= def.viability * k ? def.growthRate * p * (1 - p / k) : 0;
    const next = p + (growth + def.seedRate * (k - p)) * dt;
    stock[i] = next < 0 ? 0 : next > k ? k : next;
  }
}

/** Move stock toward equal density (stock / capacity) between neighbours; conserves the total. */
function diffuse(eco: Ecology, s: number, def: SpeciesDef, dt: number): void {
  const d = Math.min(def.diffusionRate * dt, MAX_DIFFUSION);
  if (d <= 0) return;
  const stock = eco.stock[s]!;
  const cap = eco.capacity[s]!;
  const delta = eco.scratch;
  const from = eco.edgeFrom[s]!;
  const to = eco.edgeTo[s]!;
  for (let e = 0; e < from.length; e++) {
    const i = from[e]!;
    const j = to[e]!;
    const ki = cap[i]!;
    const kj = cap[j]!;
    const flow = d * (stock[i]! / ki - stock[j]! / kj) * (ki < kj ? ki : kj);
    delta[i]! -= flow;
    delta[j]! += flow;
  }
  // Apply and clear the scratch values for the tiles this species lives on only.
  for (const i of eco.active[s]!) {
    const next = stock[i]! + delta[i]!;
    delta[i] = 0;
    stock[i] = next < EXTINCT_BELOW ? 0 : next;
  }
}

/**
 * One ecology step covering `dt` ticks (rates are per tick, so a longer step just applies more of them):
 * animals graze and grow, plants regrow, then every species spreads. Only tiles a species lives on are visited.
 */
export function stepEcology(_world: World, eco: Ecology, dt = 1): void {
  eco.species.forEach((def, s) => {
    if (def.kind === 'animal') stepAnimal(eco, s, def, dt);
  });
  eco.species.forEach((def, s) => {
    if (def.kind === 'plant') stepPlant(eco, s, def, dt);
  });
  eco.species.forEach((def, s) => diffuse(eco, s, def, dt));
}

/** Total stock of every species across the world. */
export function speciesTotals(eco: Ecology): number[] {
  return eco.stock.map((stock, s) => {
    let sum = 0;
    for (const i of eco.active[s]!) sum += stock[i]!;
    return sum;
  });
}

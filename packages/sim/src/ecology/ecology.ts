import { SPECIES_LIST, type AnimalDef, type SpeciesDef } from '../data/species';
import { TERRAIN_LIST } from '../data/terrain';
import type { Rng } from '../rng';
import type { World } from '../world';

/** Stock below this is treated as extinct on that tile. */
const EXTINCT_BELOW = 1e-4;
/** Fraction of an animal stock lost per step on a tile it cannot inhabit. */
const OUT_OF_HABITAT_DECAY = 0.2;

export interface Ecology {
  readonly species: readonly SpeciesDef[];
  /** Per species, per tile: the most stock the tile can hold (0 = uninhabitable). */
  readonly capacity: readonly Float32Array[];
  /** Per species, per tile: current stock. */
  readonly stock: readonly Float32Array[];
  /** Scratch buffer for diffusion. */
  readonly scratch: Float32Array;
  /** For animals: indices of the plant species they eat. */
  readonly dietIndices: readonly (readonly number[])[];
}

function habitatCapacity(def: SpeciesDef, world: World): Float32Array {
  const affinity = new Float32Array(TERRAIN_LIST.length);
  for (const t of TERRAIN_LIST)
    affinity[t.id] = def.terrainAffinity[t.key as keyof typeof def.terrainAffinity] ?? 0;
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

/** Build capacities from terrain and moisture, and start every tile at a random fraction of capacity. */
export function createEcology(
  world: World,
  rng: Rng,
  species: readonly SpeciesDef[] = SPECIES_LIST,
): Ecology {
  const capacity = species.map((def) => habitatCapacity(def, world));
  const stock = capacity.map((cap) => {
    const s = new Float32Array(cap.length);
    for (let i = 0; i < s.length; i++) s[i] = cap[i]! * rng.next();
    return s;
  });
  const keyToIndex = new Map(species.map((d, i) => [d.key, i]));
  const dietIndices = species.map((def) =>
    def.kind === 'animal'
      ? def.diet.map((key) => {
          const idx = keyToIndex.get(key);
          if (idx === undefined) throw new Error(`${def.key} eats unknown species ${key}`);
          return idx;
        })
      : [],
  );
  return { species, capacity, stock, scratch: new Float32Array(world.terrain.length), dietIndices };
}

/** Animals graze their diet, then grow when fed and shrink when hungry. */
function stepAnimal(eco: Ecology, s: number, def: AnimalDef): void {
  const stock = eco.stock[s]!;
  const cap = eco.capacity[s]!;
  const diet = eco.dietIndices[s]!.map((p) => eco.stock[p]!);
  for (let i = 0; i < stock.length; i++) {
    const a = stock[i]!;
    if (a === 0) continue;
    const k = cap[i]!;
    if (k === 0) {
      const left = a * (1 - OUT_OF_HABITAT_DECAY);
      stock[i] = left < EXTINCT_BELOW ? 0 : left;
      continue;
    }
    const demand = a * def.intake;
    let food = 0;
    for (const plant of diet) food += plant[i]!;
    const eaten = Math.min(food, demand);
    if (eaten > 0) for (const plant of diet) plant[i]! -= (eaten * plant[i]!) / food;
    const satisfaction = demand > 0 ? eaten / demand : 1;
    const growth =
      def.growthRate * a * (1 - a / k) * satisfaction - def.starvationRate * a * (1 - satisfaction);
    const next = a + growth;
    stock[i] = next < EXTINCT_BELOW ? 0 : next;
  }
}

/** Plants regrow logistically from current stock, plus a small seed bank. */
function stepPlant(eco: Ecology, s: number, def: SpeciesDef): void {
  const stock = eco.stock[s]!;
  const cap = eco.capacity[s]!;
  for (let i = 0; i < stock.length; i++) {
    const k = cap[i]!;
    if (k === 0) {
      stock[i] = 0;
      continue;
    }
    const p = stock[i]!;
    const next = p + def.growthRate * p * (1 - p / k) + def.seedRate * (k - p);
    stock[i] = next < 0 ? 0 : next > k ? k : next;
  }
}

/** Move stock toward equal density (stock / capacity) between neighbours; conserves the total. */
function diffuse(eco: Ecology, s: number, def: SpeciesDef, width: number, height: number): void {
  const d = def.diffusionRate;
  if (d <= 0) return;
  const stock = eco.stock[s]!;
  const cap = eco.capacity[s]!;
  const delta = eco.scratch;
  delta.fill(0);
  const edge = (i: number, j: number): void => {
    const ki = cap[i]!;
    const kj = cap[j]!;
    if (ki === 0 || kj === 0) return;
    const flow = d * (stock[i]! / ki - stock[j]! / kj) * (ki < kj ? ki : kj);
    delta[i]! -= flow;
    delta[j]! += flow;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x + 1 < width) edge(i, i + 1);
      if (y + 1 < height) edge(i, i + width);
    }
  }
  for (let i = 0; i < stock.length; i++) {
    const next = stock[i]! + delta[i]!;
    stock[i] = next < EXTINCT_BELOW ? 0 : next;
  }
}

/** One ecology step: animals graze and grow, plants regrow, then every species spreads. */
export function stepEcology(world: World, eco: Ecology): void {
  eco.species.forEach((def, s) => {
    if (def.kind === 'animal') stepAnimal(eco, s, def);
  });
  eco.species.forEach((def, s) => {
    if (def.kind === 'plant') stepPlant(eco, s, def);
  });
  eco.species.forEach((def, s) => diffuse(eco, s, def, world.width, world.height));
}

/** Total stock of every species across the world. */
export function speciesTotals(eco: Ecology): number[] {
  return eco.stock.map((stock) => {
    let sum = 0;
    for (const v of stock) sum += v;
    return sum;
  });
}

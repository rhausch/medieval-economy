import { FOLK } from '../data/folk';
import { GOODS_LIST } from '../data/goods';
import { TERRAIN_LIST } from '../data/terrain';
import type { Ecology } from '../ecology';
import type { Rng } from '../rng';
import type { World } from '../world';

/** Folk stored as typed-array columns, one slot per Folk. Slot index is not the Folk id. */
export interface FolkStore {
  readonly count: number;
  readonly id: Uint32Array;
  readonly x: Int32Array;
  readonly y: Int32Array;
  readonly satiety: Float32Array;
  readonly health: Float32Array;
  readonly energy: Float32Array;
  readonly age: Uint32Array;
  readonly foraging: Float32Array;
  readonly hunting: Float32Array;
  /** Index into FOLK_ACTIONS. */
  readonly action: Uint8Array;
  /** count x GOODS_LIST.length quantities, slot-major. */
  readonly inventory: Float32Array;
  /** Where Folk appear. */
  readonly settlement: { x: number; y: number };
  nextId: number;
}

export function walkableTable(): Uint8Array {
  const table = new Uint8Array(TERRAIN_LIST.length);
  for (const t of TERRAIN_LIST) table[t.id] = t.walkable ? 1 : 0;
  return table;
}

function plantFoodAt(eco: Ecology, i: number): number {
  let sum = 0;
  eco.species.forEach((def, s) => {
    if (def.kind === 'plant') sum += eco.stock[s]![i]!;
  });
  return sum;
}

/** Best of several random walkable tiles near water, scored by the plant food around them. */
function findSettlement(world: World, eco: Ecology, rng: Rng): { x: number; y: number } {
  const walkable = walkableTable();
  const { width, height, terrain } = world;
  const isWater = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && terrain[y * width + x] === 0;
  const nearWater = (x: number, y: number): boolean => {
    const r = FOLK.settlementWaterDistance;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if (isWater(x + dx, y + dy)) return true;
    return false;
  };
  let best: { x: number; y: number } | null = null;
  let bestScore = -1;
  let evaluated = 0;
  for (let attempt = 0; attempt < FOLK.settlementCandidates * 50; attempt++) {
    const x = Math.floor(rng.next() * width);
    const y = Math.floor(rng.next() * height);
    if (!walkable[terrain[y * width + x]!] || !nearWater(x, y)) continue;
    let score = 0;
    const r = FOLK.settlementScoreRadius;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px >= 0 && py >= 0 && px < width && py < height)
          score += plantFoodAt(eco, py * width + px);
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
    if (++evaluated >= FOLK.settlementCandidates) break;
  }
  if (best) return best;
  // No tile near water: fall back to the first walkable tile.
  for (let i = 0; i < terrain.length; i++) {
    if (walkable[terrain[i]!]) return { x: i % width, y: Math.floor(i / width) };
  }
  return { x: 0, y: 0 };
}

/** A random walkable tile within the spawn radius of the settlement. */
function spawnTile(
  world: World,
  walkable: Uint8Array,
  settlement: { x: number; y: number },
  rng: Rng,
) {
  const r = FOLK.spawnRadius;
  for (let attempt = 0; attempt < 50; attempt++) {
    const x = settlement.x + Math.floor(rng.next() * (2 * r + 1)) - r;
    const y = settlement.y + Math.floor(rng.next() * (2 * r + 1)) - r;
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
    if (walkable[world.terrain[y * world.width + x]!]) return { x, y };
  }
  return settlement;
}

/** Put a new Folk into a slot, at full health and energy with a random starting satiety. */
export function initFolk(
  store: FolkStore,
  slot: number,
  world: World,
  rng: Rng,
  walkable: Uint8Array,
): { id: number; x: number; y: number } {
  const at = spawnTile(world, walkable, store.settlement, rng);
  store.nextId += 1;
  store.id[slot] = store.nextId;
  store.x[slot] = at.x;
  store.y[slot] = at.y;
  store.satiety[slot] =
    FOLK.startSatiety.min + rng.next() * (FOLK.startSatiety.max - FOLK.startSatiety.min);
  store.health[slot] = FOLK.maxStat;
  store.energy[slot] = FOLK.maxStat;
  store.age[slot] = 0;
  store.foraging[slot] = 0;
  store.hunting[slot] = 0;
  store.action[slot] = 0;
  store.inventory.fill(0, slot * GOODS_LIST.length, (slot + 1) * GOODS_LIST.length);
  return { id: store.nextId, x: at.x, y: at.y };
}

export function createFolkStore(world: World, eco: Ecology, rng: Rng, count: number): FolkStore {
  return {
    count,
    id: new Uint32Array(count),
    x: new Int32Array(count),
    y: new Int32Array(count),
    satiety: new Float32Array(count),
    health: new Float32Array(count),
    energy: new Float32Array(count),
    age: new Uint32Array(count),
    foraging: new Float32Array(count),
    hunting: new Float32Array(count),
    action: new Uint8Array(count),
    inventory: new Float32Array(count * GOODS_LIST.length),
    settlement: findSettlement(world, eco, rng),
    nextId: 0,
  };
}

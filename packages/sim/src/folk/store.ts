import type { Settings } from '../config';
import { OPTION_COUNT, PENDING_NONE } from '../data/actions';
import { GOODS_LIST } from '../data/goods';
import { TERRAIN_LIST } from '../data/terrain';
import { MAX_PARAMS } from '../deciders/types';
import type { Ecology } from '../ecology';
import type { Rng } from '../rng';
import type { World } from '../world';

/** Folk stored as typed-array columns, one slot per Folk. Slot index is not the Folk id. */
export interface FolkStore {
  readonly count: number;
  readonly id: Uint32Array;
  readonly x: Int32Array;
  readonly y: Int32Array;
  /** Calories in the reserve: the one number a Folk lives on. */
  readonly reserve: Float32Array;
  readonly age: Uint32Array;
  readonly foraging: Float32Array;
  readonly hunting: Float32Array;
  /** Index into FOLK_ACTIONS. */
  readonly action: Uint8Array;
  /** count x GOODS_LIST.length kilograms, slot-major. */
  readonly inventory: Float32Array;
  /** Index into DECIDERS. */
  readonly decider: Uint8Array;
  /** count x MAX_PARAMS decider parameters, slot-major, in the decider's parameter order. */
  readonly params: Float32Array;
  /** 0 none, 1 minor, 2 serious; and ticks until it heals one level. */
  readonly injury: Uint8Array;
  readonly injuryTimer: Float32Array;
  /** The Folk is busy until this tick; `pending` is what it is doing (PENDING_NONE when free). */
  readonly busyUntil: Uint32Array;
  readonly pending: Uint8Array;
  readonly pendingTile: Int32Array;
  /** The option and target tile it is working toward (PENDING_NONE / -1 when it has none). */
  readonly intent: Uint8Array;
  readonly intentTile: Int32Array;
  /** Walk to the intent tile: tiles still to step on, and how far along. */
  readonly paths: (Int32Array | null)[];
  readonly pathPos: Uint16Array;
  /** count x OPTION_COUNT scores from the last decision (NaN = unavailable) and the option chosen. */
  readonly scores: Float32Array;
  readonly choice: Uint8Array;
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
function findSettlement(
  world: World,
  eco: Ecology,
  rng: Rng,
  settings: Settings['folk'],
): { x: number; y: number } {
  const walkable = walkableTable();
  const { width, height, terrain } = world;
  const isWater = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && terrain[y * width + x] === 0;
  const nearWater = (x: number, y: number): boolean => {
    const r = settings.settlementWaterDistance;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) if (isWater(x + dx, y + dy)) return true;
    }
    return false;
  };
  let best: { x: number; y: number } | null = null;
  let bestScore = -1;
  let evaluated = 0;
  for (let attempt = 0; attempt < settings.settlementCandidates * 50; attempt++) {
    const x = Math.floor(rng.next() * width);
    const y = Math.floor(rng.next() * height);
    if (!walkable[terrain[y * width + x]!] || !nearWater(x, y)) continue;
    let score = 0;
    const r = settings.settlementScoreRadius;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px >= 0 && py >= 0 && px < width && py < height) {
          score += plantFoodAt(eco, py * width + px);
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
    if (++evaluated >= settings.settlementCandidates) break;
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
  radius: number,
) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const x = settlement.x + Math.floor(rng.next() * (2 * radius + 1)) - radius;
    const y = settlement.y + Math.floor(rng.next() * (2 * radius + 1)) - radius;
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
    if (walkable[world.terrain[y * world.width + x]!]) return { x, y };
  }
  return settlement;
}

/** Put a new Folk into a slot with the given decider and random parameters drawn from its ranges. */
export function initFolk(
  store: FolkStore,
  slot: number,
  world: World,
  rng: Rng,
  walkable: Uint8Array,
  deciderIndex: number,
  settings: Settings,
): { id: number; x: number; y: number; decider: string; params: number[]; reserve: number } {
  const at = spawnTile(world, walkable, store.settlement, rng, settings.folk.spawnRadius);
  const decider = settings.deciders[deciderIndex]!;
  const { min, max } = settings.body.startReserveFraction;
  store.nextId += 1;
  store.id[slot] = store.nextId;
  store.x[slot] = at.x;
  store.y[slot] = at.y;
  store.reserve[slot] = settings.body.reserveCapacity * (min + rng.next() * (max - min));
  store.age[slot] = 0;
  store.foraging[slot] = 0;
  store.hunting[slot] = 0;
  store.action[slot] = 0;
  store.inventory.fill(0, slot * GOODS_LIST.length, (slot + 1) * GOODS_LIST.length);
  store.decider[slot] = deciderIndex;
  store.params.fill(0, slot * MAX_PARAMS, (slot + 1) * MAX_PARAMS);
  const params = decider.params.map((spec, i) => {
    const value = spec.min + (spec.max - spec.min) * rng.next();
    store.params[slot * MAX_PARAMS + i] = value;
    return Number(value.toFixed(4));
  });
  store.injury[slot] = 0;
  store.injuryTimer[slot] = 0;
  store.busyUntil[slot] = 0;
  store.pending[slot] = PENDING_NONE;
  store.pendingTile[slot] = -1;
  store.intent[slot] = PENDING_NONE;
  store.intentTile[slot] = -1;
  store.paths[slot] = null;
  store.pathPos[slot] = 0;
  store.scores.fill(Number.NaN, slot * OPTION_COUNT, (slot + 1) * OPTION_COUNT);
  store.choice[slot] = 0;
  return {
    id: store.nextId,
    x: at.x,
    y: at.y,
    decider: decider.key,
    params,
    reserve: store.reserve[slot]!,
  };
}

export function createFolkStore(
  world: World,
  eco: Ecology,
  rng: Rng,
  count: number,
  settings: Settings,
): FolkStore {
  return {
    count,
    id: new Uint32Array(count),
    x: new Int32Array(count),
    y: new Int32Array(count),
    reserve: new Float32Array(count),
    age: new Uint32Array(count),
    foraging: new Float32Array(count),
    hunting: new Float32Array(count),
    action: new Uint8Array(count),
    inventory: new Float32Array(count * GOODS_LIST.length),
    decider: new Uint8Array(count),
    params: new Float32Array(count * MAX_PARAMS),
    injury: new Uint8Array(count),
    injuryTimer: new Float32Array(count),
    busyUntil: new Uint32Array(count),
    pending: new Uint8Array(count),
    pendingTile: new Int32Array(count),
    intent: new Uint8Array(count),
    intentTile: new Int32Array(count),
    paths: Array.from({ length: count }, () => null),
    pathPos: new Uint16Array(count),
    scores: new Float32Array(count * OPTION_COUNT),
    choice: new Uint8Array(count),
    settlement: findSettlement(world, eco, rng, settings.folk),
    nextId: 0,
  };
}

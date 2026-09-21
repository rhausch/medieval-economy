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
  /** 1 while the Folk is alive; a dead Folk that is not replaced stays in its slot with 0. */
  readonly alive: Uint8Array;
  /** Every walkable tile of the largest connected land: where a lone Folk may appear. */
  readonly spawnTiles: Int32Array;
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
  /**
   * The Folk is busy until this time (in ticks, fractional); `pending` is what it is doing
   * (PENDING_NONE when free). A walking step over slow ground takes more than one tick, and the
   * fraction carries into the next action so speed is not lost to rounding.
   */
  readonly readyAt: Float64Array;
  readonly pending: Uint8Array;
  readonly pendingTile: Int32Array;
  /** How long the current step takes, in ticks, including any injury slowdown. */
  readonly pendingTicks: Float32Array;
  /**
   * The Folk's goal, kept on its blackboard: the option it is pursuing (PENDING_NONE when it has none),
   * where, when it was chosen, and the path still to walk with how far along it is.
   */
  readonly goal: Uint8Array;
  readonly goalTile: Int32Array;
  readonly goalTick: Uint32Array;
  readonly goalPath: (Int32Array | null)[];
  readonly goalPos: Uint16Array;
  /**
   * What the Folk remembers (its blackboard): `memorySlots` places per Folk. Each is a species, a tile with
   * enough of it, how much was there when last seen (kg or head) and the tick it was last seen.
   * Empty slots have species -1.
   */
  readonly memSpecies: Int8Array;
  readonly memTile: Int32Array;
  readonly memAmount: Float32Array;
  readonly memSeen: Int32Array;
  /** The explored map: per Folk, one number per square of the grid: the tick it was last in sight, or -1. */
  readonly seenCells: Int32Array;
  /** How many squares each Folk has seen (so the explored share needs no counting). */
  readonly seenCount: Uint32Array;
  /** The tick of the Folk's last interrupt, so one cannot fire again straight away. */
  readonly interruptedAt: Int32Array;
  /** count x OPTION_COUNT scores from the last decision (NaN = unavailable) and the option chosen. */
  readonly scores: Float32Array;
  readonly choice: Uint8Array;
  /** Where Folk appear. */
  readonly settlement: { x: number; y: number };
  nextId: number;
}

/** The explored map's grid: squares of `perception.cellSize` tiles. */
export function gridOf(
  world: World,
  settings: Settings,
): { cols: number; rows: number; cells: number } {
  const size = settings.perception.cellSize;
  const cols = Math.ceil(world.width / size);
  const rows = Math.ceil(world.height / size);
  return { cols, rows, cells: cols * rows };
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

/** The tiles of the largest connected stretch of walkable land (4-connected). */
export function mainland(world: World, walkable: Uint8Array): Int32Array {
  const n = world.terrain.length;
  const label = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let best = { size: 0, id: -1 };
  let id = 0;
  for (let start = 0; start < n; start++) {
    if (label[start] !== -1 || !walkable[world.terrain[start]!]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const tile = queue[head++]!;
      const x = tile % world.width;
      const y = (tile - x) / world.width;
      const neighbours = [
        x > 0 ? tile - 1 : -1,
        x < world.width - 1 ? tile + 1 : -1,
        y > 0 ? tile - world.width : -1,
        y < world.height - 1 ? tile + world.width : -1,
      ];
      for (const t of neighbours) {
        if (t < 0 || label[t] !== -1 || !walkable[world.terrain[t]!]) continue;
        label[t] = id;
        queue[tail++] = t;
      }
    }
    if (tail > best.size) best = { size: tail, id };
    id++;
  }
  const out = new Int32Array(best.size);
  let k = 0;
  for (let i = 0; i < n && k < best.size; i++) if (label[i] === best.id) out[k++] = i;
  return out;
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
): {
  id: number;
  x: number;
  y: number;
  decider: string;
  params: number[];
  reserve: number;
  terrain: string;
} {
  // Alone at a random place on the main landmass, or together around the settlement.
  const tile =
    settings.folk.spawnRandom === 1 && store.spawnTiles.length > 0
      ? store.spawnTiles[Math.floor(rng.next() * store.spawnTiles.length)]!
      : -1;
  const at =
    tile >= 0
      ? { x: tile % world.width, y: Math.floor(tile / world.width) }
      : spawnTile(world, walkable, store.settlement, rng, settings.folk.spawnRadius);
  const decider = settings.deciders[deciderIndex]!;
  const { min, max } = settings.body.startReserveFraction;
  store.nextId += 1;
  store.alive[slot] = 1;
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
  store.readyAt[slot] = 0;
  store.pending[slot] = PENDING_NONE;
  store.pendingTile[slot] = -1;
  store.pendingTicks[slot] = 0;
  store.goal[slot] = PENDING_NONE;
  store.goalTile[slot] = -1;
  store.goalTick[slot] = 0;
  store.goalPath[slot] = null;
  store.goalPos[slot] = 0;
  store.interruptedAt[slot] = -1000;
  const slots = settings.perception.memorySlots;
  store.memSpecies.fill(-1, slot * slots, (slot + 1) * slots);
  store.memTile.fill(-1, slot * slots, (slot + 1) * slots);
  store.memAmount.fill(0, slot * slots, (slot + 1) * slots);
  store.memSeen.fill(0, slot * slots, (slot + 1) * slots);
  const cells = gridOf(world, settings).cells;
  store.seenCells.fill(-1, slot * cells, (slot + 1) * cells);
  store.seenCount[slot] = 0;
  store.scores.fill(Number.NaN, slot * OPTION_COUNT, (slot + 1) * OPTION_COUNT);
  store.choice[slot] = 0;
  return {
    id: store.nextId,
    x: at.x,
    y: at.y,
    decider: decider.key,
    params,
    reserve: store.reserve[slot]!,
    terrain: TERRAIN_LIST[world.terrain[at.y * world.width + at.x]!]!.key,
  };
}

export function createFolkStore(
  world: World,
  eco: Ecology,
  rng: Rng,
  count: number,
  settings: Settings,
): FolkStore {
  const walkable = walkableTable();
  return {
    count,
    alive: new Uint8Array(count),
    spawnTiles: settings.folk.spawnRandom === 1 ? mainland(world, walkable) : new Int32Array(0),
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
    readyAt: new Float64Array(count),
    pending: new Uint8Array(count),
    pendingTile: new Int32Array(count),
    pendingTicks: new Float32Array(count),
    goal: new Uint8Array(count),
    goalTile: new Int32Array(count),
    goalTick: new Uint32Array(count),
    goalPath: Array.from({ length: count }, () => null),
    goalPos: new Uint16Array(count),
    interruptedAt: new Int32Array(count),
    memSpecies: new Int8Array(count * settings.perception.memorySlots).fill(-1),
    memTile: new Int32Array(count * settings.perception.memorySlots).fill(-1),
    memAmount: new Float32Array(count * settings.perception.memorySlots),
    memSeen: new Int32Array(count * settings.perception.memorySlots),
    seenCells: new Int32Array(count * gridOf(world, settings).cells).fill(-1),
    seenCount: new Uint32Array(count),
    scores: new Float32Array(count * OPTION_COUNT),
    choice: new Uint8Array(count),
    settlement: findSettlement(world, eco, rng, settings.folk),
    nextId: 0,
  };
}

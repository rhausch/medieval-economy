import { FOLK, FOLK_ACTIONS } from '../data/folk';
import type { Ecology } from '../ecology';
import type { SimEvent } from '../events';
import type { Rng } from '../rng';
import type { World } from '../world';
import { initFolk, walkableTable, type FolkStore } from './store';

const ACTION = {
  idle: FOLK_ACTIONS.indexOf('idle'),
  moving: FOLK_ACTIONS.indexOf('moving'),
  eating: FOLK_ACTIONS.indexOf('eating'),
  resting: FOLK_ACTIONS.indexOf('resting'),
};

/** Neighbour offsets in a fixed order so searches are deterministic. */
const DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export interface FolkContext {
  readonly world: World;
  readonly eco: Ecology;
  readonly store: FolkStore;
  readonly rng: Rng;
  readonly events: SimEvent[];
  readonly emitMoves: boolean;
  readonly walkable: Uint8Array;
  readonly plantSpecies: readonly number[];
  readonly search: {
    queue: Int32Array;
    firstStep: Int32Array;
    stamp: Uint32Array;
    current: number;
  };
}

export function createFolkContext(
  world: World,
  eco: Ecology,
  store: FolkStore,
  rng: Rng,
  events: SimEvent[],
  emitMoves: boolean,
): FolkContext {
  const n = world.width * world.height;
  return {
    world,
    eco,
    store,
    rng,
    events,
    emitMoves,
    walkable: walkableTable(),
    plantSpecies: eco.species.flatMap((d, s) => (d.kind === 'plant' ? [s] : [])),
    search: {
      queue: new Int32Array(n),
      firstStep: new Int32Array(n),
      stamp: new Uint32Array(n),
      current: 0,
    },
  };
}

function plantFoodAt(ctx: FolkContext, tile: number): number {
  let sum = 0;
  for (const s of ctx.plantSpecies) sum += ctx.eco.stock[s]![tile]!;
  return sum;
}

/**
 * Breadth-first search over walkable tiles for the nearest tile with enough plant food.
 * Returns the tile index of the first step toward it, or -1 if none is within reach.
 * Folk currently know the whole map (within search depth); perception limits come later.
 */
function firstStepToFood(ctx: FolkContext, startX: number, startY: number): number {
  const { world, walkable, search } = ctx;
  const { width, height, terrain } = world;
  search.current += 1;
  const stamp = search.current;
  const start = startY * width + startX;
  let head = 0;
  let tail = 0;
  search.queue[tail++] = start;
  search.stamp[start] = stamp;
  search.firstStep[start] = -1;
  // BFS layers are tracked by queue position rather than a per-tile depth.
  let layerEnd = tail;
  let layer = 0;
  while (head < tail) {
    if (head === layerEnd) {
      layer += 1;
      layerEnd = tail;
      if (layer > FOLK.searchDepth) return -1;
    }
    const current = search.queue[head++]!;
    const cx = current % width;
    const cy = (current - cx) / width;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (search.stamp[next] === stamp || !walkable[terrain[next]!]) continue;
      search.stamp[next] = stamp;
      search.firstStep[next] = current === start ? next : search.firstStep[current]!;
      if (plantFoodAt(ctx, next) >= FOLK.minFoodTile) return search.firstStep[next]!;
      search.queue[tail++] = next;
    }
  }
  return -1;
}

function moveTo(ctx: FolkContext, slot: number, tile: number, tick: number): void {
  const { store, world } = ctx;
  const fromX = store.x[slot]!;
  const fromY = store.y[slot]!;
  const x = tile % world.width;
  const y = (tile - x) / world.width;
  store.x[slot] = x;
  store.y[slot] = y;
  store.energy[slot] = Math.max(0, store.energy[slot]! - FOLK.moveEnergyCost);
  store.action[slot] = ACTION.moving;
  if (ctx.emitMoves) {
    ctx.events.push({ tick, type: 'move', folk: store.id[slot]!, x, y, fromX, fromY });
  }
}

function wander(ctx: FolkContext, slot: number, tick: number): void {
  const { store, world, rng, walkable } = ctx;
  if (rng.next() < FOLK.idleChance) {
    store.action[slot] = ACTION.idle;
    store.energy[slot] = Math.min(FOLK.maxStat, store.energy[slot]! + FOLK.idleEnergyGain);
    return;
  }
  const x = store.x[slot]!;
  const y = store.y[slot]!;
  const options: number[] = [];
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
    const tile = ny * world.width + nx;
    if (walkable[world.terrain[tile]!]) options.push(tile);
  }
  if (options.length === 0) {
    store.action[slot] = ACTION.idle;
    return;
  }
  moveTo(ctx, slot, options[Math.floor(rng.next() * options.length)]!, tick);
}

/** Eat plant food from the tile the Folk stands on, taking from each plant in proportion to its stock. */
function eatHere(ctx: FolkContext, slot: number, tick: number): void {
  const { store, world, eco } = ctx;
  const tile = store.y[slot]! * world.width + store.x[slot]!;
  const available = plantFoodAt(ctx, tile);
  const room = FOLK.maxStat - store.satiety[slot]!;
  const eaten = Math.min(FOLK.bite, available, room);
  if (eaten <= 0) return;
  for (const s of ctx.plantSpecies) {
    const stock = eco.stock[s]!;
    stock[tile] = stock[tile]! - (eaten * stock[tile]!) / available;
  }
  store.satiety[slot] = store.satiety[slot]! + eaten;
  store.action[slot] = ACTION.eating;
  ctx.events.push({
    tick,
    type: 'eat',
    folk: store.id[slot]!,
    x: store.x[slot]!,
    y: store.y[slot]!,
    food: eaten,
    satiety: store.satiety[slot]!,
  });
}

/** Rule-based baseline: hunger first, then rest, then wander. */
function act(ctx: FolkContext, slot: number, tick: number): void {
  const { store, world } = ctx;
  const tile = store.y[slot]! * world.width + store.x[slot]!;

  if (store.satiety[slot]! < FOLK.hungerThreshold) {
    if (plantFoodAt(ctx, tile) >= FOLK.minFoodTile) return eatHere(ctx, slot, tick);
    const step = firstStepToFood(ctx, store.x[slot]!, store.y[slot]!);
    if (step >= 0) return moveTo(ctx, slot, step, tick);
    return wander(ctx, slot, tick);
  }

  const resting = store.action[slot] === ACTION.resting;
  if (
    store.energy[slot]! < FOLK.tiredThreshold ||
    (resting && store.energy[slot]! < FOLK.restUntil)
  ) {
    store.action[slot] = ACTION.resting;
    store.energy[slot] = Math.min(FOLK.maxStat, store.energy[slot]! + FOLK.restEnergyGain);
    return;
  }
  wander(ctx, slot, tick);
}

/** Advance every Folk one tick: needs, health, death and replacement, then one action. */
export function stepFolk(ctx: FolkContext, tick: number): void {
  const { store } = ctx;
  for (let slot = 0; slot < store.count; slot++) {
    store.age[slot] = store.age[slot]! + 1;
    store.satiety[slot] = Math.max(0, store.satiety[slot]! - FOLK.satietyDecay);
    if (store.satiety[slot]! <= 0) {
      store.health[slot] = store.health[slot]! - FOLK.starvationDamage;
    } else if (store.satiety[slot]! > FOLK.regenSatiety) {
      store.health[slot] = Math.min(FOLK.maxStat, store.health[slot]! + FOLK.regen);
    }

    if (store.health[slot]! <= 0) {
      ctx.events.push({
        tick,
        type: 'die',
        folk: store.id[slot]!,
        x: store.x[slot]!,
        y: store.y[slot]!,
        cause: 'starvation',
      });
      const born = initFolk(store, slot, ctx.world, ctx.rng, ctx.walkable);
      ctx.events.push({
        tick,
        type: 'spawn',
        folk: born.id,
        x: born.x,
        y: born.y,
        reason: 'replacement',
      });
      continue;
    }
    act(ctx, slot, tick);
  }
}

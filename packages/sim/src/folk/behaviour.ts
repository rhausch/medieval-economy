import {
  FORAGE_ACTIONS,
  MAX_SUCCESS,
  OPTION,
  OPTION_COUNT,
  PENDING_IDLE,
  PENDING_MOVE,
  PENDING_NONE,
  SKILL_GAIN,
  SKILL_SUCCESS_BONUS,
  SKILL_YIELD_BONUS,
  forageDef,
  type ForageDef,
} from '../data/actions';
import { FOLK, FOLK_ACTIONS, INJURY } from '../data/folk';
import { GOODS_LIST } from '../data/goods';
import { DECIDERS, MAX_PARAMS, type Intent, type Senses } from '../deciders';
import type { Ecology } from '../ecology';
import type { SimEvent } from '../events';
import type { Rng } from '../rng';
import type { World } from '../world';
import {
  COUNTER,
  COUNTER_COUNT,
  actionIndex,
  eatenIndex,
  folkCounters,
  sourceIndex,
  type Metrics,
} from '../metrics';
import type { Perf } from '../perf';
import { initFolk, walkableTable, type FolkStore } from './store';

const ACTION = Object.fromEntries(FOLK_ACTIONS.map((name, i) => [name, i])) as Record<
  (typeof FOLK_ACTIONS)[number],
  number
>;
/** The action label shown while a Folk is busy with each option. */
const OPTION_LABEL: Record<number, number> = {
  [OPTION.eat]: ACTION.eating,
  [OPTION.gather]: ACTION.gathering,
  [OPTION.dig]: ACTION.digging,
  [OPTION.snare]: ACTION.snaring,
  [OPTION.chase]: ACTION.chasing,
  [OPTION.rest]: ACTION.resting,
  [PENDING_MOVE]: ACTION.moving,
  [PENDING_IDLE]: ACTION.idle,
};

/** Neighbour offsets in a fixed order so searches are deterministic. */
const DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

const goodIndex = (key: string): number => GOODS_LIST.findIndex((g) => g.key === key);

interface ForageTarget {
  def: ForageDef;
  species: number;
  good: number;
}

export interface FolkContext {
  readonly world: World;
  readonly eco: Ecology;
  readonly store: FolkStore;
  readonly metrics: Metrics;
  /** Timing hooks; null when no timer was supplied. */
  readonly perf: Perf | null;
  readonly rng: Rng;
  readonly events: SimEvent[];
  readonly emitMoves: boolean;
  /** Multiplier on satiety decay. */
  readonly hungerScale: number;
  readonly walkable: Uint8Array;
  readonly forage: readonly ForageTarget[];
  readonly senses: Senses;
  readonly intent: Intent;
  readonly search: {
    queue: Int32Array;
    parent: Int32Array;
    stamp: Uint32Array;
    current: number;
  };
}

export function createFolkContext(
  world: World,
  eco: Ecology,
  store: FolkStore,
  metrics: Metrics,
  perf: Perf | null,
  rng: Rng,
  events: SimEvent[],
  emitMoves: boolean,
  hungerScale: number,
): FolkContext {
  const n = world.width * world.height;
  const forage = FORAGE_ACTIONS.map((def) => {
    const species = eco.species.findIndex((s) => s.key === def.species);
    if (species < 0) throw new Error(`action ${def.key} works unknown species ${def.species}`);
    return { def, species, good: goodIndex(def.good) };
  });
  return {
    world,
    eco,
    store,
    metrics,
    perf,
    rng,
    events,
    emitMoves,
    hungerScale,
    walkable: walkableTable(),
    forage,
    senses: {
      x: 0,
      y: 0,
      satiety: 0,
      health: 0,
      energy: 0,
      injury: 0,
      foodSatiety: 0,
      room: 0,
      foraging: 0,
      hunting: 0,
      resting: false,
      durationMultiplier: 1,
      params: store.params,
      paramBase: 0,
      targetTile: new Int32Array(OPTION_COUNT),
      targetDist: new Int32Array(OPTION_COUNT),
    },
    intent: { option: OPTION.wander, tile: -1 },
    search: {
      queue: new Int32Array(n),
      parent: new Int32Array(n),
      stamp: new Uint32Array(n),
      current: 0,
    },
  };
}

/** Add to one of a Folk's lifetime counters. */
function count(ctx: FolkContext, slot: number, counter: number, amount: number): void {
  ctx.metrics.folk[slot * COUNTER_COUNT + counter]! += amount;
}

/** Record energy a Folk spent doing something, in the per-decider and per-Folk totals. */
function spendEnergy(ctx: FolkContext, slot: number, label: number, cost: number): void {
  const { store } = ctx;
  const before = store.energy[slot]!;
  const spent = before - Math.max(0, before - cost);
  store.energy[slot] = before - spent;
  ctx.metrics.energySpent[actionIndex(store.decider[slot]!, label)]! += spent;
  count(ctx, slot, COUNTER.energySpent, spent);
}

/** Record energy a Folk regained by resting or standing idle. */
function gainEnergy(ctx: FolkContext, slot: number, label: number, gain: number): void {
  const { store } = ctx;
  const before = store.energy[slot]!;
  store.energy[slot] = Math.min(FOLK.maxStat, before + gain);
  ctx.metrics.energyGained[actionIndex(store.decider[slot]!, label)]! +=
    store.energy[slot]! - before;
}

/** Weight the Folk carries. */
function carried(ctx: FolkContext, slot: number): number {
  let weight = 0;
  GOODS_LIST.forEach((g, k) => {
    weight += ctx.store.inventory[slot * GOODS_LIST.length + k]! * g.weight;
  });
  return weight;
}

/** Satiety the Folk would gain by eating everything edible it carries. */
function foodSatiety(ctx: FolkContext, slot: number): number {
  let total = 0;
  GOODS_LIST.forEach((g, k) => {
    if (g.edible) total += ctx.store.inventory[slot * GOODS_LIST.length + k]! * g.foodValue;
  });
  return total;
}

/**
 * Breadth-first search over walkable tiles. For every foraging option it records the nearest tile
 * that has enough of the species and how far it is to walk. Folk currently know the whole map within
 * the search depth; perception limits come later.
 */
function scanTargets(ctx: FolkContext, startX: number, startY: number): void {
  const { world, walkable, search, senses, eco } = ctx;
  const { width, height, terrain } = world;
  senses.targetTile.fill(-1);
  senses.targetDist.fill(-1);
  let missing = ctx.forage.length;

  const check = (tile: number, dist: number): void => {
    for (const f of ctx.forage) {
      if (senses.targetTile[f.def.option]! >= 0) continue;
      if (eco.stock[f.species]![tile]! >= f.def.minStock) {
        senses.targetTile[f.def.option] = tile;
        senses.targetDist[f.def.option] = dist;
        missing--;
      }
    }
  };

  search.current += 1;
  const stamp = search.current;
  const start = startY * width + startX;
  let head = 0;
  let tail = 0;
  search.queue[tail++] = start;
  search.stamp[start] = stamp;
  search.parent[start] = -1;
  check(start, 0);
  // BFS layers are tracked by queue position rather than a per-tile depth.
  let layerEnd = tail;
  let layer = 0;
  while (head < tail && missing > 0) {
    if (head === layerEnd) {
      layer += 1;
      layerEnd = tail;
      if (layer > FOLK.searchDepth) return;
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
      search.parent[next] = current;
      check(next, layer + 1);
      search.queue[tail++] = next;
    }
  }
}

/** Tiles to walk from the scan start to `target`, in order (excluding the start). */
function pathTo(ctx: FolkContext, target: number): Int32Array {
  const steps: number[] = [];
  for (let t = target; ctx.search.parent[t]! >= 0; t = ctx.search.parent[t]!) steps.push(t);
  return Int32Array.from(steps.reverse());
}

function multiplier(store: FolkStore, slot: number): number {
  return INJURY.durationMultiplier[store.injury[slot]!]!;
}

function begin(ctx: FolkContext, slot: number, tick: number, pending: number, ticks: number): void {
  const { store } = ctx;
  store.pending[slot] = pending;
  store.busyUntil[slot] = tick + Math.max(1, Math.ceil(ticks * multiplier(store, slot)));
  store.action[slot] = OPTION_LABEL[pending] ?? ACTION.idle;
}

function beginStepTo(ctx: FolkContext, slot: number, tick: number, tile: number): void {
  ctx.store.pendingTile[slot] = tile;
  begin(ctx, slot, tick, PENDING_MOVE, 1);
}

function wander(ctx: FolkContext, slot: number, tick: number): void {
  const { store, world, rng, walkable } = ctx;
  if (rng.next() < FOLK.idleChance) return begin(ctx, slot, tick, PENDING_IDLE, 1);
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
  if (options.length === 0) return begin(ctx, slot, tick, PENDING_IDLE, 1);
  beginStepTo(ctx, slot, tick, options[Math.floor(rng.next() * options.length)]!);
}

/** Fill the shared senses object for one Folk. */
function sense(ctx: FolkContext, slot: number): void {
  const { store, senses } = ctx;
  senses.x = store.x[slot]!;
  senses.y = store.y[slot]!;
  senses.satiety = store.satiety[slot]!;
  senses.health = store.health[slot]!;
  senses.energy = store.energy[slot]!;
  senses.injury = store.injury[slot]!;
  senses.foodSatiety = foodSatiety(ctx, slot);
  senses.room = FOLK.carryCapacity - carried(ctx, slot);
  senses.foraging = store.foraging[slot]!;
  senses.hunting = store.hunting[slot]!;
  senses.resting = store.action[slot] === ACTION.resting;
  senses.durationMultiplier = multiplier(store, slot);
  senses.paramBase = slot * MAX_PARAMS;
}

/** Ask the Folk's decider what to do and start doing it. */
function decide(ctx: FolkContext, slot: number, tick: number): void {
  const { store, senses, intent, world, perf } = ctx;
  const t0 = perf?.timer();
  scanTargets(ctx, store.x[slot]!, store.y[slot]!);
  sense(ctx, slot);
  const t1 = perf?.timer();
  const scores = store.scores.subarray(slot * OPTION_COUNT, (slot + 1) * OPTION_COUNT);
  DECIDERS[store.decider[slot]!]!.decide(senses, intent, scores);
  if (perf && t0 !== undefined && t1 !== undefined) {
    perf.scan.record(t1 - t0);
    perf.decide[store.decider[slot]!]!.record(perf.timer() - t1);
  }
  store.choice[slot] = intent.option;

  switch (intent.option) {
    case OPTION.eat:
      return begin(ctx, slot, tick, OPTION.eat, 1);
    case OPTION.rest:
      return begin(ctx, slot, tick, OPTION.rest, FOLK.restTicks);
    case OPTION.wander:
      return wander(ctx, slot, tick);
  }
  // A foraging option: head for the target tile, then work it.
  const here = store.y[slot]! * world.width + store.x[slot]!;
  store.intent[slot] = intent.option;
  store.intentTile[slot] = intent.tile;
  store.paths[slot] = intent.tile === here ? null : pathTo(ctx, intent.tile);
  store.pathPos[slot] = 0;
  continueIntent(ctx, slot, tick);
}

function clearIntent(store: FolkStore, slot: number): void {
  store.intent[slot] = PENDING_NONE;
  store.intentTile[slot] = -1;
  store.paths[slot] = null;
}

/** Keep going toward the current foraging intent: walk the next step, or start the work on arrival. */
function continueIntent(ctx: FolkContext, slot: number, tick: number): void {
  const { store, world, eco } = ctx;
  const path = store.paths[slot];
  const pos = store.pathPos[slot]!;
  if (path && pos < path.length) {
    store.pathPos[slot] = pos + 1;
    return beginStepTo(ctx, slot, tick, path[pos]!);
  }
  const target = ctx.forage.find((f) => f.def.option === store.intent[slot]);
  const here = store.y[slot]! * world.width + store.x[slot]!;
  const room = FOLK.carryCapacity - carried(ctx, slot);
  if (!target || eco.stock[target.species]![here]! < target.def.minStock || room < 1) {
    // Someone got there first, or there is nowhere to put it: think again next tick.
    clearIntent(store, slot);
    return;
  }
  begin(ctx, slot, tick, target.def.option, target.def.ticks);
}

function addGood(ctx: FolkContext, slot: number, good: number, amount: number): void {
  const at = slot * GOODS_LIST.length + good;
  ctx.store.inventory[at] = ctx.store.inventory[at]! + amount;
}

/** Eat from the inventory, best food per unit first. */
function eat(ctx: FolkContext, slot: number, tick: number): void {
  const { store } = ctx;
  let bite = FOLK.eatBite;
  let units = 0;
  const order = GOODS_LIST.filter((g) => g.edible).sort((a, b) => b.foodValue - a.foodValue);
  for (const g of order) {
    const at = slot * GOODS_LIST.length + g.id;
    const room = (FOLK.maxStat - store.satiety[slot]!) / g.foodValue;
    const taken = Math.min(store.inventory[at]!, bite, room);
    if (taken <= 0) continue;
    store.inventory[at] = store.inventory[at]! - taken;
    store.satiety[slot] = store.satiety[slot]! + taken * g.foodValue;
    const eatenAt = eatenIndex(store.decider[slot]!, g.id);
    ctx.metrics.eaten[eatenAt]! += taken;
    ctx.metrics.eaten[eatenAt + 1]! += taken * g.foodValue;
    count(ctx, slot, COUNTER.satietyEaten, taken * g.foodValue);
    bite -= taken;
    units += taken;
  }
  if (units <= 0) return;
  count(ctx, slot, COUNTER.meals, 1);
  ctx.events.push({
    tick,
    type: 'eat',
    folk: store.id[slot]!,
    x: store.x[slot]!,
    y: store.y[slot]!,
    food: units,
    satiety: store.satiety[slot]!,
  });
}

function injure(ctx: FolkContext, slot: number, tick: number, def: ForageDef): void {
  const { store, rng } = ctx;
  const roll = rng.next();
  const level = roll < def.seriousInjury ? 2 : roll < def.seriousInjury + def.minorInjury ? 1 : 0;
  if (level === 0) return;
  count(ctx, slot, COUNTER.injuries, 1);
  store.health[slot] = store.health[slot]! - INJURY.damage[level]!;
  if (level > store.injury[slot]!) {
    store.injury[slot] = level;
    store.injuryTimer[slot] = INJURY.healTicks[level]!;
  }
  ctx.events.push({
    tick,
    type: 'injure',
    folk: store.id[slot]!,
    x: store.x[slot]!,
    y: store.y[slot]!,
    severity: level === 2 ? 'serious' : 'minor',
    action: def.key,
  });
}

/** Finish a foraging action: take from the tile stock into the inventory, then roll for injury. */
function forageResult(ctx: FolkContext, slot: number, tick: number, option: number): void {
  const { store, eco, rng, world } = ctx;
  const target = ctx.forage.find((f) => f.def.option === option);
  const def = forageDef(option);
  if (!target || !def) return;
  const tile = store.y[slot]! * world.width + store.x[slot]!;
  const stock = eco.stock[target.species]!;
  const room = FOLK.carryCapacity - carried(ctx, slot);
  const skill = def.skill === 'foraging' ? store.foraging[slot]! : store.hunting[slot]!;
  const x = store.x[slot]!;
  const y = store.y[slot]!;
  const at = sourceIndex(store.decider[slot]!, target.species, world.terrain[tile]!);
  const goodDef = GOODS_LIST[target.good]!;
  const record = (success: boolean, units: number): void => {
    ctx.metrics.sources[at]! += 1;
    ctx.metrics.sources[at + 1]! += success ? 1 : 0;
    ctx.metrics.sources[at + 2]! += units;
    ctx.metrics.sources[at + 3]! += units * goodDef.foodValue;
    count(ctx, slot, COUNTER.attempts, 1);
    count(ctx, slot, COUNTER.successes, success ? 1 : 0);
    count(
      ctx,
      slot,
      target.good === goodIndex('meat') ? COUNTER.meatUnits : COUNTER.plantUnits,
      units,
    );
  };

  if (def.kind === 'plant') {
    const amount = Math.min(def.yield * (1 + SKILL_YIELD_BONUS * skill), stock[tile]!, room);
    if (amount > 0) {
      stock[tile] = stock[tile]! - amount;
      addGood(ctx, slot, target.good, amount);
    }
    ctx.events.push({
      tick,
      type: 'gather',
      folk: store.id[slot]!,
      x,
      y,
      species: def.species,
      amount,
    });
    record(amount > 0, amount);
  } else {
    const chance = Math.min(MAX_SUCCESS, def.baseSuccess + SKILL_SUCCESS_BONUS * skill);
    const success = rng.next() < chance && stock[tile]! >= 1;
    const meat = success ? Math.min(def.yield, room) : 0;
    if (success) {
      stock[tile] = stock[tile]! - 1;
      addGood(ctx, slot, target.good, meat);
    }
    ctx.events.push({
      tick,
      type: 'hunt',
      folk: store.id[slot]!,
      x,
      y,
      species: def.species,
      success,
      meat,
    });
    record(success, meat);
  }

  spendEnergy(ctx, slot, OPTION_LABEL[option]!, def.energy);
  const gained = SKILL_GAIN * (1 - skill);
  if (def.skill === 'foraging') store.foraging[slot] = skill + gained;
  else store.hunting[slot] = skill + gained;
  injure(ctx, slot, tick, def);
}

/** Apply the outcome of whatever a Folk just finished doing. */
function resolve(ctx: FolkContext, slot: number, tick: number): void {
  const { store, world } = ctx;
  const pending = store.pending[slot]!;
  store.pending[slot] = PENDING_NONE;
  switch (pending) {
    case PENDING_MOVE: {
      const tile = store.pendingTile[slot]!;
      const fromX = store.x[slot]!;
      const fromY = store.y[slot]!;
      store.x[slot] = tile % world.width;
      store.y[slot] = Math.floor(tile / world.width);
      spendEnergy(ctx, slot, ACTION.moving, FOLK.moveEnergyCost);
      count(ctx, slot, COUNTER.steps, 1);
      if (ctx.emitMoves) {
        ctx.events.push({
          tick,
          type: 'move',
          folk: store.id[slot]!,
          x: store.x[slot]!,
          y: store.y[slot]!,
          fromX,
          fromY,
        });
      }
      return;
    }
    case PENDING_IDLE:
      gainEnergy(ctx, slot, ACTION.idle, FOLK.idleEnergyGain);
      return;
    case OPTION.rest:
      gainEnergy(ctx, slot, ACTION.resting, FOLK.restEnergyGain);
      return;
    case OPTION.eat:
      return eat(ctx, slot, tick);
    default:
      forageResult(ctx, slot, tick, pending);
      clearIntent(store, slot);
  }
}

/** Age, hunger, healing and starvation for one Folk; returns true if it died and was replaced. */
function liveAndDie(ctx: FolkContext, slot: number, tick: number): boolean {
  const { store } = ctx;
  store.age[slot] = store.age[slot]! + 1;
  store.satiety[slot] = Math.max(0, store.satiety[slot]! - FOLK.satietyDecay * ctx.hungerScale);
  if (store.satiety[slot]! <= 0) {
    store.health[slot] = store.health[slot]! - FOLK.starvationDamage;
  } else if (store.satiety[slot]! > FOLK.regenSatiety) {
    store.health[slot] = Math.min(FOLK.maxStat, store.health[slot]! + FOLK.regen);
  }

  if (store.injury[slot]! > 0) {
    store.injuryTimer[slot] = store.injuryTimer[slot]! - 1;
    if (store.injuryTimer[slot]! <= 0) {
      const level = store.injury[slot]! - 1;
      store.injury[slot] = level;
      store.injuryTimer[slot] = INJURY.healTicks[level]!;
      ctx.events.push({
        tick,
        type: 'heal',
        folk: store.id[slot]!,
        x: store.x[slot]!,
        y: store.y[slot]!,
        severity: level === 0 ? 'none' : 'minor',
      });
    }
  }

  if (store.health[slot]! > 0) return false;
  ctx.events.push({
    tick,
    type: 'die',
    folk: store.id[slot]!,
    x: store.x[slot]!,
    y: store.y[slot]!,
    cause: store.satiety[slot]! <= 0 ? 'starvation' : 'injury',
    lived: store.age[slot]!,
    stats: folkCounters(ctx.metrics, slot),
  });
  ctx.metrics.folk.fill(0, slot * COUNTER_COUNT, (slot + 1) * COUNTER_COUNT);
  // The replacement keeps the dead Folk's decider (so the mix stays constant) with fresh parameters.
  const born = initFolk(store, slot, ctx.world, ctx.rng, ctx.walkable, store.decider[slot]!);
  ctx.events.push({
    tick,
    type: 'spawn',
    folk: born.id,
    x: born.x,
    y: born.y,
    reason: 'replacement',
    decider: born.decider,
    params: born.params,
  });
  return true;
}

/** Advance every Folk one tick: needs, healing and death, finish any completed action, then start the next. */
export function stepFolk(ctx: FolkContext, tick: number): void {
  const { store } = ctx;
  for (let slot = 0; slot < store.count; slot++) {
    if (liveAndDie(ctx, slot, tick)) continue;
    if (tick >= store.busyUntil[slot]!) {
      if (store.pending[slot] !== PENDING_NONE) resolve(ctx, slot, tick);
      if (store.intent[slot] !== PENDING_NONE) continueIntent(ctx, slot, tick);
      if (store.pending[slot] === PENDING_NONE) decide(ctx, slot, tick);
    }
    ctx.metrics.actionTicks[actionIndex(store.decider[slot]!, store.action[slot]!)]! += 1;
  }
}

import {
  OPTION,
  OPTION_COUNT,
  PENDING_IDLE,
  PENDING_MOVE,
  PENDING_NONE,
  type ForageDef,
} from '../data/actions';
import { FOLK_ACTIONS, type FolkAction } from '../data/folk';
import type { Settings } from '../config';
import { DECIDERS, MAX_PARAMS, type Intent, type Senses } from '../deciders';
import type { Ecology } from '../ecology';
import type { SimEvent } from '../events';
import {
  COUNTER,
  COUNTER_COUNT,
  LEDGER_ACTIONS,
  LEDGER_BASELINE,
  LEDGER_HEALING,
  actionIndex,
  eatenIndex,
  folkCounters,
  ledgerIndex,
  sourceIndex,
  type Metrics,
} from '../metrics';
import type { Perf } from '../perf';
import type { Rng } from '../rng';
import type { World } from '../world';
import { initFolk, walkableTable, type FolkStore } from './store';

const ACTION = Object.fromEntries(FOLK_ACTIONS.map((name, i) => [name, i])) as Record<
  FolkAction,
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
  readonly settings: Settings;
  readonly rng: Rng;
  readonly events: SimEvent[];
  readonly emitMoves: boolean;
  readonly walkable: Uint8Array;
  readonly forage: readonly ForageTarget[];
  /** Calories above baseline burned per tick for each action label. */
  readonly labelCost: Float64Array;
  /** Indices of edible goods, densest food first. */
  readonly edibleOrder: readonly number[];
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
  settings: Settings,
  rng: Rng,
  events: SimEvent[],
  emitMoves: boolean,
): FolkContext {
  const n = world.width * world.height;
  const forage = settings.actions.map((def) => {
    const species = eco.species.findIndex((s) => s.key === def.species);
    if (species < 0) throw new Error(`action ${def.key} works unknown species ${def.species}`);
    const good = settings.goods.findIndex((g) => g.key === def.good);
    if (good < 0) throw new Error(`action ${def.key} produces unknown good ${def.good}`);
    return { def, species, good };
  });
  const labelCost = new Float64Array(FOLK_ACTIONS.length);
  labelCost[ACTION.idle] = settings.activity.idle;
  labelCost[ACTION.moving] = settings.activity.moving;
  labelCost[ACTION.eating] = settings.activity.eating;
  labelCost[ACTION.resting] = settings.activity.resting;
  for (const f of forage) labelCost[OPTION_LABEL[f.def.option]!] = f.def.kcalPerTick;
  const edibleOrder = settings.goods
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g.edible)
    .sort((a, b) => b.g.kcalPerKg - a.g.kcalPerKg)
    .map(({ i }) => i);
  return {
    world,
    eco,
    store,
    metrics,
    perf,
    settings,
    rng,
    events,
    emitMoves,
    walkable: walkableTable(),
    forage,
    labelCost,
    edibleOrder,
    senses: {
      x: 0,
      y: 0,
      reserve: 0,
      capacity: settings.body.reserveCapacity,
      injury: 0,
      foodKcal: 0,
      roomKg: 0,
      foraging: 0,
      hunting: 0,
      resting: false,
      durationMultiplier: 1,
      params: store.params,
      paramBase: 0,
      targetTile: new Int32Array(OPTION_COUNT),
      targetDist: new Int32Array(OPTION_COUNT),
      settings,
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

/** Kilograms the Folk carries. */
function carriedKg(ctx: FolkContext, slot: number): number {
  const goods = ctx.settings.goods.length;
  let kg = 0;
  for (let g = 0; g < goods; g++) kg += ctx.store.inventory[slot * goods + g]!;
  return kg;
}

/** Calories the Folk would gain by eating everything edible it carries. */
function foodKcal(ctx: FolkContext, slot: number): number {
  const goods = ctx.settings.goods;
  let kcal = 0;
  goods.forEach((g, k) => {
    if (g.edible) kcal += ctx.store.inventory[slot * goods.length + k]! * g.kcalPerKg;
  });
  return kcal;
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
      if (layer > ctx.settings.folk.searchDepth) return;
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

function multiplier(ctx: FolkContext, slot: number): number {
  return ctx.settings.injury.durationMultiplier[ctx.store.injury[slot]!]!;
}

function begin(ctx: FolkContext, slot: number, tick: number, pending: number, ticks: number): void {
  const { store } = ctx;
  store.pending[slot] = pending;
  store.busyUntil[slot] = tick + Math.max(1, Math.ceil(ticks * multiplier(ctx, slot)));
  store.action[slot] = OPTION_LABEL[pending] ?? ACTION.idle;
}

function beginStepTo(ctx: FolkContext, slot: number, tick: number, tile: number): void {
  ctx.store.pendingTile[slot] = tile;
  begin(ctx, slot, tick, PENDING_MOVE, 1);
}

function wander(ctx: FolkContext, slot: number, tick: number): void {
  const { store, world, rng, walkable } = ctx;
  if (rng.next() < ctx.settings.folk.idleChance) return begin(ctx, slot, tick, PENDING_IDLE, 1);
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
  const { store, senses, settings } = ctx;
  senses.x = store.x[slot]!;
  senses.y = store.y[slot]!;
  senses.reserve = store.reserve[slot]!;
  senses.capacity = settings.body.reserveCapacity;
  senses.injury = store.injury[slot]!;
  senses.foodKcal = foodKcal(ctx, slot);
  senses.roomKg = settings.folk.carryCapacityKg - carriedKg(ctx, slot);
  senses.foraging = store.foraging[slot]!;
  senses.hunting = store.hunting[slot]!;
  senses.resting = store.action[slot] === ACTION.resting;
  senses.durationMultiplier = multiplier(ctx, slot);
  senses.paramBase = slot * MAX_PARAMS;
}

/** Calories one meal would add right now, and how many ticks it takes to eat them. */
function mealKcal(ctx: FolkContext, slot: number): number {
  const { body } = ctx.settings;
  return Math.min(
    foodKcal(ctx, slot),
    body.reserveCapacity - ctx.store.reserve[slot]!,
    body.mealKcal,
  );
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
    case OPTION.eat: {
      const kcal = mealKcal(ctx, slot);
      // Nothing to eat or no room: a decider asked for the impossible, so do nothing useful this tick.
      if (kcal <= 0) return wander(ctx, slot, tick);
      return begin(
        ctx,
        slot,
        tick,
        OPTION.eat,
        Math.ceil(kcal / ctx.settings.body.maxIntakeKcalPerTick),
      );
    }
    case OPTION.rest:
      return begin(ctx, slot, tick, OPTION.rest, ctx.settings.folk.restTicks);
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
  const roomKg = ctx.settings.folk.carryCapacityKg - carriedKg(ctx, slot);
  if (!target || eco.stock[target.species]![here]! < target.def.minStock || roomKg < 0.5) {
    // Someone got there first, or there is nowhere to put it: think again next tick.
    clearIntent(store, slot);
    return;
  }
  begin(ctx, slot, tick, target.def.option, target.def.ticks);
}

/** Eat from the inventory, densest food first, up to one meal. */
function eat(ctx: FolkContext, slot: number, tick: number): void {
  const { store, settings, metrics } = ctx;
  const goods = settings.goods;
  const decider = store.decider[slot]!;
  let budget = mealKcal(ctx, slot);
  let kcalTotal = 0;
  let kgTotal = 0;
  for (const g of ctx.edibleOrder) {
    if (budget <= 0) break;
    const at = slot * goods.length + g;
    const density = goods[g]!.kcalPerKg;
    const kg = Math.min(store.inventory[at]!, budget / density);
    if (kg <= 0) continue;
    const kcal = kg * density;
    store.inventory[at] = store.inventory[at]! - kg;
    store.reserve[slot] = store.reserve[slot]! + kcal;
    budget -= kcal;
    kcalTotal += kcal;
    kgTotal += kg;
    metrics.eaten[eatenIndex(decider, g)]! += kg;
    metrics.eaten[eatenIndex(decider, g) + 1]! += kcal;
  }
  if (kcalTotal <= 0) return;
  count(ctx, slot, COUNTER.meals, 1);
  count(ctx, slot, COUNTER.kcalEaten, kcalTotal);
  ctx.events.push({
    tick,
    type: 'eat',
    folk: store.id[slot]!,
    x: store.x[slot]!,
    y: store.y[slot]!,
    kg: kgTotal,
    kcal: kcalTotal,
    reserve: store.reserve[slot]!,
  });
}

function injure(ctx: FolkContext, slot: number, tick: number, def: ForageDef): void {
  const { store, rng, settings } = ctx;
  const roll = rng.next();
  const level = roll < def.seriousInjury ? 2 : roll < def.seriousInjury + def.minorInjury ? 1 : 0;
  if (level === 0) return;
  count(ctx, slot, COUNTER.injuries, 1);
  if (level > store.injury[slot]!) {
    store.injury[slot] = level;
    store.injuryTimer[slot] = settings.injury.healTicks[level]!;
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
  const { store, eco, rng, world, settings } = ctx;
  const target = ctx.forage.find((f) => f.def.option === option);
  if (!target) return;
  const def = target.def;
  const tile = store.y[slot]! * world.width + store.x[slot]!;
  const stock = eco.stock[target.species]!;
  const roomKg = settings.folk.carryCapacityKg - carriedKg(ctx, slot);
  const skill = def.skill === 'foraging' ? store.foraging[slot]! : store.hunting[slot]!;
  const x = store.x[slot]!;
  const y = store.y[slot]!;
  const at = sourceIndex(store.decider[slot]!, target.species, world.terrain[tile]!);
  const density = settings.goods[target.good]!.kcalPerKg;
  const inventoryAt = slot * settings.goods.length + target.good;
  const record = (success: boolean, kg: number): void => {
    ctx.metrics.sources[at]! += 1;
    ctx.metrics.sources[at + 1]! += success ? 1 : 0;
    ctx.metrics.sources[at + 2]! += kg;
    ctx.metrics.sources[at + 3]! += kg * density;
    count(ctx, slot, COUNTER.attempts, 1);
    count(ctx, slot, COUNTER.successes, success ? 1 : 0);
    count(ctx, slot, def.good === 'meat' ? COUNTER.meatKg : COUNTER.plantKg, kg);
  };

  if (def.kind === 'plant') {
    const kg = Math.min(def.yield * (1 + settings.skills.yieldBonus * skill), stock[tile]!, roomKg);
    if (kg > 0) {
      stock[tile] = stock[tile]! - kg;
      store.inventory[inventoryAt] = store.inventory[inventoryAt]! + kg;
    }
    ctx.events.push({
      tick,
      type: 'gather',
      folk: store.id[slot]!,
      x,
      y,
      species: def.species,
      kg,
    });
    record(kg > 0, kg);
  } else {
    const chance = Math.min(
      settings.skills.maxSuccess,
      def.baseSuccess + settings.skills.successBonus * skill,
    );
    const success = rng.next() < chance && stock[tile]! >= 1;
    const kg = success ? Math.min(def.yield, roomKg) : 0;
    if (success) {
      stock[tile] = stock[tile]! - 1;
      store.inventory[inventoryAt] = store.inventory[inventoryAt]! + kg;
    }
    ctx.events.push({
      tick,
      type: 'hunt',
      folk: store.id[slot]!,
      x,
      y,
      species: def.species,
      success,
      kg,
    });
    record(success, kg);
  }

  const gained = settings.skills.gain * (1 - skill);
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
    case OPTION.rest:
      return;
    case OPTION.eat:
      return eat(ctx, slot, tick);
    default:
      forageResult(ctx, slot, tick, pending);
      clearIntent(store, slot);
  }
}

/**
 * One tick of living: burn calories (baseline, what the Folk is doing, and healing), heal, and die if
 * the reserve is gone. Returns true if it died and was replaced.
 */
function liveAndDie(ctx: FolkContext, slot: number, tick: number): boolean {
  const { store, settings, metrics } = ctx;
  const decider = store.decider[slot]!;
  store.age[slot] = store.age[slot]! + 1;

  const label = store.action[slot]!;
  const level = store.injury[slot]!;
  const baseline = settings.body.baselineKcalPerTick;
  const activity = ctx.labelCost[label]!;
  const healing = level > 0 ? settings.injury.healKcalPerTick[level]! : 0;
  store.reserve[slot] = store.reserve[slot]! - (baseline + activity + healing);
  metrics.ledger[ledgerIndex(decider, LEDGER_BASELINE)]! += baseline;
  metrics.ledger[ledgerIndex(decider, LEDGER_HEALING)]! += healing;
  metrics.ledger[ledgerIndex(decider, LEDGER_ACTIONS + label)]! += activity;
  count(ctx, slot, COUNTER.kcalSpent, baseline + activity + healing);

  if (level > 0) {
    const speed = label === ACTION.resting ? settings.injury.restHealFactor : 1;
    store.injuryTimer[slot] = store.injuryTimer[slot]! - speed;
    if (store.injuryTimer[slot]! <= 0) {
      const healed = level - 1;
      store.injury[slot] = healed;
      store.injuryTimer[slot] = settings.injury.healTicks[healed]!;
      ctx.events.push({
        tick,
        type: 'heal',
        folk: store.id[slot]!,
        x: store.x[slot]!,
        y: store.y[slot]!,
        severity: healed === 0 ? 'none' : 'minor',
      });
    }
  }

  let cause: 'starvation' | 'injury' | null = null;
  if (store.reserve[slot]! <= 0) cause = 'starvation';
  else {
    const chance = settings.injury.deathChancePerTick[store.injury[slot]!]!;
    if (chance > 0 && ctx.rng.next() < chance) cause = 'injury';
  }
  if (!cause) return false;

  ctx.events.push({
    tick,
    type: 'die',
    folk: store.id[slot]!,
    x: store.x[slot]!,
    y: store.y[slot]!,
    cause,
    lived: store.age[slot]!,
    stats: folkCounters(ctx.metrics, slot),
  });
  ctx.metrics.folk.fill(0, slot * COUNTER_COUNT, (slot + 1) * COUNTER_COUNT);
  // The replacement keeps the dead Folk's decider (so the mix stays constant) with fresh parameters.
  const born = initFolk(store, slot, ctx.world, ctx.rng, ctx.walkable, decider, settings);
  ctx.events.push({
    tick,
    type: 'spawn',
    folk: born.id,
    x: born.x,
    y: born.y,
    reason: 'replacement',
    decider: born.decider,
    params: born.params,
    reserve: born.reserve,
  });
  return true;
}

/** Advance every Folk one tick: living and dying, finish any completed action, then start the next. */
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

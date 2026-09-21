import {
  OPTION,
  OPTION_COUNT,
  OPTION_NAMES,
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
  travelIndex,
  type Metrics,
} from '../metrics';
import type { Perf } from '../perf';
import type { Rng } from '../rng';
import type { World } from '../world';
import { climbMeters, createRouter, routeTo, search, stepTicks, type Router } from './routing';
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
  readonly emitGoals: boolean;
  readonly walkable: Uint8Array;
  readonly router: Router;
  readonly forage: readonly ForageTarget[];
  /** Calories above baseline burned per tick for each action label. */
  readonly labelCost: Float64Array;
  /** Indices of edible goods, densest food first. */
  readonly edibleOrder: readonly number[];
  readonly senses: Senses;
  readonly intent: Intent;
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
  emitGoals: boolean,
): FolkContext {
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
    emitGoals,
    walkable: walkableTable(),
    router: createRouter(world, settings),
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
      targetTicks: new Float32Array(OPTION_COUNT),
      targetKcal: new Float32Array(OPTION_COUNT),
      settings,
    },
    intent: { option: OPTION.wander, tile: -1 },
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
 * Find, for every foraging option, the place that takes the least walking time to reach and has enough of
 * the species, with the time and calories the walk costs. Folk currently know the whole map within the
 * search budget; perception limits come later.
 */
function scanTargets(ctx: FolkContext, start: number): void {
  const { world, settings, router, senses, eco } = ctx;
  senses.targetTile.fill(-1);
  senses.targetTicks.fill(0);
  senses.targetKcal.fill(0);
  let missing = ctx.forage.length;
  search(world, settings, router, start, (tile, ticks, kcal) => {
    for (const f of ctx.forage) {
      if (senses.targetTile[f.def.option]! >= 0) continue;
      if (eco.stock[f.species]![tile]! >= f.def.minStock) {
        senses.targetTile[f.def.option] = tile;
        senses.targetTicks[f.def.option] = ticks;
        senses.targetKcal[f.def.option] = kcal;
        missing--;
      }
    }
    return missing === 0;
  });
}

function multiplier(ctx: FolkContext, slot: number): number {
  return ctx.settings.injury.durationMultiplier[ctx.store.injury[slot]!]!;
}

/**
 * Start doing something that takes `ticks`. It begins when the Folk became free, which can be a fraction of a
 * tick earlier than now (a step over slow ground rarely ends on a whole tick), so no speed is lost to rounding.
 */
function begin(
  ctx: FolkContext,
  slot: number,
  tick: number,
  pending: number,
  ticks: number,
  scaleForInjury = true,
): void {
  const { store } = ctx;
  const free = store.readyAt[slot]!;
  const start = free > tick - 1 ? free : tick;
  store.pending[slot] = pending;
  store.readyAt[slot] = start + (scaleForInjury ? ticks * multiplier(ctx, slot) : ticks);
  store.action[slot] = OPTION_LABEL[pending] ?? ACTION.idle;
}

/** Take one step onto the adjacent tile; how long it takes depends on the ground and the slope. */
function beginStepTo(ctx: FolkContext, slot: number, tick: number, tile: number): void {
  const { store, world, settings, router } = ctx;
  const from = store.y[slot]! * world.width + store.x[slot]!;
  const ticks = stepTicks(world, settings, router, from, tile) * multiplier(ctx, slot);
  store.pendingTile[slot] = tile;
  store.pendingTicks[slot] = ticks;
  begin(ctx, slot, tick, PENDING_MOVE, ticks, false);
}

function clearGoal(store: FolkStore, slot: number): void {
  store.goal[slot] = PENDING_NONE;
  store.goalTile[slot] = -1;
  store.goalPath[slot] = null;
  store.goalPos[slot] = 0;
}

/** Put a goal on the Folk's blackboard: what it is after, where, and the way there. */
function setGoal(
  ctx: FolkContext,
  slot: number,
  tick: number,
  option: number,
  tile: number,
  path: Int32Array | null,
  estimatedTicks: number,
): void {
  const { store, world } = ctx;
  store.goal[slot] = option;
  store.goalTile[slot] = tile;
  store.goalTick[slot] = tick;
  store.goalPath[slot] = path;
  store.goalPos[slot] = 0;
  count(ctx, slot, COUNTER.goals, 1);
  if (ctx.emitGoals) {
    ctx.events.push({
      tick,
      type: 'goal',
      folk: store.id[slot]!,
      x: store.x[slot]!,
      y: store.y[slot]!,
      option: OPTION_NAMES[option]!,
      targetX: tile % world.width,
      targetY: Math.floor(tile / world.width),
      ticks: estimatedTicks,
    });
  }
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

/** Calories one meal would add right now. */
function mealKcal(ctx: FolkContext, slot: number): number {
  const { body } = ctx.settings;
  return Math.min(
    foodKcal(ctx, slot),
    body.reserveCapacity - ctx.store.reserve[slot]!,
    body.mealKcal,
  );
}

/** Stand still for a while, or stroll to a random spot nearby (a short goal, walked step by step). */
function wander(ctx: FolkContext, slot: number, tick: number): void {
  const { store, world, rng, walkable, settings, router } = ctx;
  const { folk } = settings;
  if (rng.next() < folk.idleChance)
    return begin(ctx, slot, tick, PENDING_IDLE, folk.idleTicks, false);
  const x = store.x[slot]!;
  const y = store.y[slot]!;
  const here = y * world.width + x;
  const r = Math.max(1, Math.floor(folk.wanderRadius));
  let target = -1;
  for (let attempt = 0; attempt < 12 && target < 0; attempt++) {
    const tx = x + Math.floor(rng.next() * (2 * r + 1)) - r;
    const ty = y + Math.floor(rng.next() * (2 * r + 1)) - r;
    if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) continue;
    const tile = ty * world.width + tx;
    if (tile !== here && walkable[world.terrain[tile]!]) target = tile;
  }
  let ticks = 0;
  if (target >= 0) {
    search(world, settings, router, here, (tile, t) => {
      ticks = t;
      return tile === target;
    });
  }
  if (target < 0 || router.closed[target] !== router.current) {
    return begin(ctx, slot, tick, PENDING_IDLE, folk.idleTicks, false);
  }
  setGoal(ctx, slot, tick, OPTION.wander, target, routeTo(router, target), ticks);
  continueGoal(ctx, slot, tick, false);
}

/** Ask the Folk's decider what to do and start doing it. */
function decide(ctx: FolkContext, slot: number, tick: number): void {
  const { store, senses, intent, world, perf, router } = ctx;
  const here = store.y[slot]! * world.width + store.x[slot]!;
  const t0 = perf?.timer();
  scanTargets(ctx, here);
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
      // Nothing to eat or no room: a decider asked for the impossible, so it wanders instead.
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
  // A foraging option: the scan just ran, so the route to the target is known.
  const path = intent.tile === here ? null : routeTo(router, intent.tile);
  setGoal(ctx, slot, tick, intent.option, intent.tile, path, senses.targetTicks[intent.option]!);
  continueGoal(ctx, slot, tick, false);
}

/** The Folk gives up its goal on the way; it will decide again. */
function interrupt(
  ctx: FolkContext,
  slot: number,
  tick: number,
  reason: 'hungry' | 'depleted',
): void {
  const { store } = ctx;
  store.interruptedAt[slot] = tick;
  count(ctx, slot, COUNTER.interrupts, 1);
  ctx.events.push({
    tick,
    type: 'interrupt',
    folk: store.id[slot]!,
    x: store.x[slot]!,
    y: store.y[slot]!,
    option: OPTION_NAMES[store.goal[slot]!]!,
    reason,
  });
  clearGoal(store, slot);
}

/**
 * Follow the goal on the blackboard: take the next step of the path, or, on arrival, start the work. When
 * `checkInterrupts` is set (between steps) it first drops the goal if the Folk's decider would rather
 * reconsider (see `shouldInterrupt`), or the place it was heading for has run out.
 */
function continueGoal(
  ctx: FolkContext,
  slot: number,
  tick: number,
  checkInterrupts: boolean,
): void {
  const { store, world, eco, settings } = ctx;
  const option = store.goal[slot]!;
  if (option === PENDING_NONE) return;
  const target = ctx.forage.find((f) => f.def.option === option);
  const goalTile = store.goalTile[slot]!;

  if (checkInterrupts) {
    // Ask the Folk's own decider whether it would rather reconsider (rate-limited so it cannot loop).
    if (tick - store.interruptedAt[slot]! >= settings.folk.interruptCooldown) {
      sense(ctx, slot);
      if (DECIDERS[store.decider[slot]!]!.shouldInterrupt(ctx.senses)) {
        return interrupt(ctx, slot, tick, 'hungry');
      }
    }
    if (target && eco.stock[target.species]![goalTile]! < target.def.minStock) {
      return interrupt(ctx, slot, tick, 'depleted');
    }
  }

  const path = store.goalPath[slot];
  const pos = store.goalPos[slot]!;
  if (path && pos < path.length) {
    store.goalPos[slot] = pos + 1;
    return beginStepTo(ctx, slot, tick, path[pos]!);
  }

  // Arrived.
  if (!target) return clearGoal(store, slot); // a stroll is over
  const here = store.y[slot]! * world.width + store.x[slot]!;
  const roomKg = settings.folk.carryCapacityKg - carriedKg(ctx, slot);
  if (eco.stock[target.species]![here]! < target.def.minStock)
    return interrupt(ctx, slot, tick, 'depleted');
  if (roomKg < 0.5) return clearGoal(store, slot);
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

/** Finish a step: move onto the tile, pay for the climb, and record the walk. */
function finishStep(ctx: FolkContext, slot: number, tick: number): void {
  const { store, world, settings, metrics } = ctx;
  const to = store.pendingTile[slot]!;
  const fromX = store.x[slot]!;
  const fromY = store.y[slot]!;
  const from = fromY * world.width + fromX;
  const climb = climbMeters(world, settings, from, to) * settings.movement.climbKcalPerMeter;
  store.x[slot] = to % world.width;
  store.y[slot] = Math.floor(to / world.width);
  if (climb > 0) {
    // Climbing burns calories on top of the per-tick cost of walking; it is charged as walking.
    store.reserve[slot] = store.reserve[slot]! - climb;
    metrics.ledger[ledgerIndex(store.decider[slot]!, LEDGER_ACTIONS + ACTION.moving)]! += climb;
    count(ctx, slot, COUNTER.kcalSpent, climb);
  }
  const travel = travelIndex(store.decider[slot]!, world.terrain[to]!);
  metrics.travel[travel]! += 1;
  metrics.travel[travel + 1]! += store.pendingTicks[slot]!;
  metrics.travel[travel + 2]! += store.pendingTicks[slot]! * settings.activity.moving + climb;
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
}

/** Apply the outcome of whatever a Folk just finished doing. */
function resolve(ctx: FolkContext, slot: number, tick: number): void {
  const { store } = ctx;
  const pending = store.pending[slot]!;
  store.pending[slot] = PENDING_NONE;
  switch (pending) {
    case PENDING_MOVE:
      return finishStep(ctx, slot, tick);
    case PENDING_IDLE:
    case OPTION.rest:
      return;
    case OPTION.eat:
      return eat(ctx, slot, tick);
    default:
      forageResult(ctx, slot, tick, pending);
      clearGoal(store, slot);
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
    if (tick >= store.readyAt[slot]!) {
      if (store.pending[slot] !== PENDING_NONE) resolve(ctx, slot, tick);
      if (store.goal[slot] !== PENDING_NONE) continueGoal(ctx, slot, tick, true);
      if (store.pending[slot] === PENDING_NONE) decide(ctx, slot, tick);
    }
    ctx.metrics.actionTicks[actionIndex(store.decider[slot]!, store.action[slot]!)]! += 1;
  }
}

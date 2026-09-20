import { FOLK_ACTIONS } from './data/folk';
import { GOODS_LIST } from './data/goods';
import { SPECIES_LIST } from './data/species';
import { TERRAIN_LIST } from './data/terrain';
import { DECIDERS } from './deciders';
import type { Ecology } from './ecology';
import type { FolkStore } from './folk/store';
import type { World } from './world';

/** Per-Folk lifetime counters, stored per slot and reset when the slot gets a new Folk. */
export const COUNTER_NAMES = [
  'meals',
  'satietyEaten',
  'plantUnits',
  'meatUnits',
  'attempts',
  'successes',
  'injuries',
  'energySpent',
  'steps',
] as const;
export const COUNTER = Object.fromEntries(COUNTER_NAMES.map((name, i) => [name, i])) as Record<
  (typeof COUNTER_NAMES)[number],
  number
>;
export const COUNTER_COUNT = COUNTER_NAMES.length;

/** Fields recorded for each place food comes from. */
export const SOURCE_FIELDS = ['attempts', 'successes', 'units', 'satiety'] as const;

const D = DECIDERS.length;
const A = FOLK_ACTIONS.length;
const S = SPECIES_LIST.length;
const T = TERRAIN_LIST.length;
const G = GOODS_LIST.length;

/**
 * Running totals for tuning and analysis, cumulative since the run began. Everything is indexed by
 * decider so the deciders can be compared in one world.
 */
export interface Metrics {
  /** Folk-ticks spent on each action: [decider][action]. */
  readonly actionTicks: Float64Array;
  /** Energy spent while doing each action, and energy regained by resting or idling. */
  readonly energySpent: Float64Array;
  readonly energyGained: Float64Array;
  /** Where food came from: [decider][species][terrain][attempts, successes, units, satiety]. */
  readonly sources: Float64Array;
  /** What was eaten: [decider][good][units, satiety]. */
  readonly eaten: Float64Array;
  /** Per-Folk counters: [slot][COUNTER]. */
  readonly folk: Float64Array;
}

export function createMetrics(folkCount: number): Metrics {
  return {
    actionTicks: new Float64Array(D * A),
    energySpent: new Float64Array(D * A),
    energyGained: new Float64Array(D * A),
    sources: new Float64Array(D * S * T * SOURCE_FIELDS.length),
    eaten: new Float64Array(D * G * 2),
    folk: new Float64Array(folkCount * COUNTER_COUNT),
  };
}

export const actionIndex = (decider: number, action: number): number => decider * A + action;
export const sourceIndex = (decider: number, species: number, terrain: number): number =>
  ((decider * S + species) * T + terrain) * SOURCE_FIELDS.length;
export const eatenIndex = (decider: number, good: number): number => (decider * G + good) * 2;

/** One Folk's lifetime counters as a name to value record. */
export function folkCounters(metrics: Metrics, slot: number): Record<string, number> {
  const out: Record<string, number> = {};
  COUNTER_NAMES.forEach((name, i) => {
    out[name] = Number(metrics.folk[slot * COUNTER_COUNT + i]!.toFixed(3));
  });
  return out;
}

export interface ActivityRow {
  decider: string;
  action: string;
  folkTicks: number;
  energySpent: number;
  energyGained: number;
}

export function activityRows(metrics: Metrics): ActivityRow[] {
  const rows: ActivityRow[] = [];
  DECIDERS.forEach((decider, d) => {
    FOLK_ACTIONS.forEach((action, a) => {
      const i = actionIndex(d, a);
      rows.push({
        decider: decider.key,
        action,
        folkTicks: metrics.actionTicks[i]!,
        energySpent: metrics.energySpent[i]!,
        energyGained: metrics.energyGained[i]!,
      });
    });
  });
  return rows;
}

export interface SourceRow {
  decider: string;
  species: string;
  terrain: string;
  attempts: number;
  successes: number;
  units: number;
  satiety: number;
}

/** Rows with at least one attempt. */
export function sourceRows(metrics: Metrics): SourceRow[] {
  const rows: SourceRow[] = [];
  DECIDERS.forEach((decider, d) => {
    SPECIES_LIST.forEach((species, s) => {
      TERRAIN_LIST.forEach((terrain, t) => {
        const i = sourceIndex(d, s, t);
        if (metrics.sources[i]! === 0) return;
        rows.push({
          decider: decider.key,
          species: species.key,
          terrain: terrain.key,
          attempts: metrics.sources[i]!,
          successes: metrics.sources[i + 1]!,
          units: metrics.sources[i + 2]!,
          satiety: metrics.sources[i + 3]!,
        });
      });
    });
  });
  return rows;
}

export interface ConsumptionRow {
  decider: string;
  good: string;
  units: number;
  satiety: number;
}

export function consumptionRows(metrics: Metrics): ConsumptionRow[] {
  const rows: ConsumptionRow[] = [];
  DECIDERS.forEach((decider, d) => {
    GOODS_LIST.forEach((good, g) => {
      const i = eatenIndex(d, g);
      if (metrics.eaten[i]! === 0) return;
      rows.push({
        decider: decider.key,
        good: good.key,
        units: metrics.eaten[i]!,
        satiety: metrics.eaten[i + 1]!,
      });
    });
  });
  return rows;
}

export interface TerrainResourceRow {
  terrain: string;
  species: string;
  /** Tiles of this terrain, and how many of them can hold this species at all. */
  tiles: number;
  habitable: number;
  stock: number;
  capacity: number;
}

/** Stock and capacity of every species on every terrain type (one full pass over the world). */
export function terrainResources(world: World, eco: Ecology): TerrainResourceRow[] {
  const tiles = new Float64Array(T);
  for (const id of world.terrain) tiles[id]! += 1;
  const rows: TerrainResourceRow[] = [];
  eco.species.forEach((species, s) => {
    const stock = new Float64Array(T);
    const capacity = new Float64Array(T);
    const habitable = new Float64Array(T);
    const stockOf = eco.stock[s]!;
    const capOf = eco.capacity[s]!;
    for (let i = 0; i < world.terrain.length; i++) {
      const t = world.terrain[i]!;
      stock[t]! += stockOf[i]!;
      capacity[t]! += capOf[i]!;
      if (capOf[i]! > 0) habitable[t]! += 1;
    }
    TERRAIN_LIST.forEach((terrain, t) => {
      rows.push({
        terrain: terrain.key,
        species: species.key,
        tiles: tiles[t]!,
        habitable: habitable[t]!,
        stock: stock[t]!,
        capacity: capacity[t]!,
      });
    });
  });
  return rows;
}

/** Units of each good currently carried by all Folk. */
export function carriedTotals(store: FolkStore): Record<string, number> {
  const out: Record<string, number> = {};
  GOODS_LIST.forEach((good, g) => {
    let sum = 0;
    for (let slot = 0; slot < store.count; slot++) sum += store.inventory[slot * G + g]!;
    out[good.key] = sum;
  });
  return out;
}

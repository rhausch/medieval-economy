import { FORAGE_ACTIONS, type ForageDef } from './data/actions';
import { GOODS_LIST, type GoodDef } from './data/goods';
import { SPECIES_LIST, type SpeciesDef } from './data/species';
import { DECIDERS } from './deciders';
import type { ParamSpec } from './deciders/types';
import { DEFAULT_WORLD_PARAMS, type WorldParams } from './world';

/**
 * Everything tunable about a run, resolved and validated. Lives in a JSON file (see `configs/`) and is
 * chosen when a run starts; it cannot change during a run. Units: a tick is 6 minutes, a tile 360 m,
 * mass is kg and energy is kcal.
 */
export interface Settings {
  units: { tickMinutes: number; tileMeters: number };
  /** The calorie reserve every Folk lives on. */
  body: {
    /** Calories burned every tick just staying alive (1,900 kcal a day is about 7.9). */
    baselineKcalPerTick: number;
    reserveCapacity: number;
    /** Starting reserve as a fraction of capacity, drawn between min and max. */
    startReserveFraction: { min: number; max: number };
    /** Most calories a Folk can eat in one tick; a meal takes as many ticks as it needs. */
    maxIntakeKcalPerTick: number;
    /** Calories eaten in one sitting at most. */
    mealKcal: number;
  };
  /** Calories per tick above baseline for non-foraging states (negative is below baseline). */
  activity: { idle: number; moving: number; eating: number; resting: number };
  injury: {
    /** Index 0 none, 1 minor, 2 serious. */
    durationMultiplier: number[];
    healKcalPerTick: number[];
    /** Ticks at that level before it heals one level. */
    healTicks: number[];
    /** Healing runs this many times faster while resting. */
    restHealFactor: number;
    /** Chance per tick of dying at that injury level. */
    deathChancePerTick: number[];
  };
  /** Walking: how fast terrain and slope let a Folk go, and what climbing costs. */
  movement: {
    /** Elevation 0 to 1 spans this many metres, which sets how steep a slope between tiles is. */
    elevationRangeM: number;
    /** A slope of grade g (rise over run) divides walking speed by 1 + slopeSlowdown * g. */
    slopeSlowdown: number;
    /** Extra calories per metre climbed, on top of the calories per tick of walking. */
    climbKcalPerMeter: number;
    /** Walking speed on each walkable terrain, in tiles per tick (1 is one tile in a tick). */
    terrainSpeed: Record<string, number>;
  };
  folk: {
    count: number;
    carryCapacityKg: number;
    /** Furthest a Folk searches for work, in ticks of walking. */
    searchTicks: number;
    /** Chance that a Folk with nothing to do stands still instead of strolling. */
    idleChance: number;
    /** How long it stands still, in ticks. */
    idleTicks: number;
    /** How far a stroll goes, in tiles. */
    wanderRadius: number;
    /** Ticks after an interrupt before another can fire (each decider decides when it wants one). */
    interruptCooldown: number;
    restTicks: number;
    spawnRadius: number;
    settlementCandidates: number;
    settlementScoreRadius: number;
    settlementWaterDistance: number;
    /** Decider keys handed out to Folk in turn. */
    deciders: string[];
  };
  skills: { gain: number; yieldBonus: number; successBonus: number; maxSuccess: number };
  goods: GoodDef[];
  actions: ForageDef[];
  species: SpeciesDef[];
  /** Each decider's parameter ranges (the order matches the decider's parameter array). */
  deciders: { key: string; params: ParamSpec[] }[];
  ecology: {
    /** Plant regrowth (and animal appetite) relative to the species table; below 1 is scarcer. */
    plantRegrowthScale: number;
    /** The ecology updates every this many ticks (its rates are per tick, so a step covers this many). */
    interval: number;
    /** Multiplies every species' patch coverage: above 1 is more food, below 1 less. */
    coverageScale: number;
    /** 1: hare and deer graze their own grass and browse; 0: they eat the berries and roots Folk gather. */
    separateAnimalFood: number;
    /** Each patch tile starts at a random share of its capacity between these. */
    initialFill: { min: number; max: number };
  };
  world: WorldParams;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(`invalid configuration: ${message}`);
    this.name = 'ConfigError';
  }
}

const clone = <T>(value: T): T => structuredClone(value);

export function defaultSettings(): Settings {
  return {
    units: { tickMinutes: 6, tileMeters: 360 },
    body: {
      baselineKcalPerTick: 7.9,
      reserveCapacity: 15000,
      startReserveFraction: { min: 0.5, max: 0.7 },
      maxIntakeKcalPerTick: 300,
      mealKcal: 1500,
    },
    activity: { idle: 2, moving: 20, eating: 4, resting: -0.8 },
    injury: {
      durationMultiplier: [1, 2, 10],
      healKcalPerTick: [0, 6, 20],
      healTicks: [0, 300, 400],
      restHealFactor: 2,
      deathChancePerTick: [0, 0, 0],
    },
    movement: {
      elevationRangeM: 1500,
      slopeSlowdown: 4,
      climbKcalPerMeter: 0.65,
      terrainSpeed: { sand: 0.8, grass: 1, forest: 0.7, hills: 0.6 },
    },
    folk: {
      count: 20,
      carryCapacityKg: 20,
      searchTicks: 90,
      idleChance: 0.4,
      idleTicks: 4,
      wanderRadius: 6,
      interruptCooldown: 10,
      restTicks: 3,
      spawnRadius: 5,
      settlementCandidates: 60,
      settlementScoreRadius: 6,
      settlementWaterDistance: 4,
      deciders: DECIDERS.map((d) => d.key),
    },
    skills: { gain: 0.004, yieldBonus: 1, successBonus: 0.4, maxSuccess: 0.95 },
    goods: clone([...GOODS_LIST]),
    actions: clone([...FORAGE_ACTIONS]),
    species: clone([...SPECIES_LIST]),
    deciders: DECIDERS.map((d) => ({ key: d.key, params: clone([...d.params]) })),
    ecology: {
      plantRegrowthScale: 1,
      interval: 10,
      coverageScale: 1,
      separateAnimalFood: 1,
      initialFill: { min: 0.3, max: 1 },
    },
    world: clone(DEFAULT_WORLD_PARAMS),
  };
}

// --- the file format: numbers only, collections keyed by name -------------------------------------

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Copy only the numeric parts of an object (numbers, arrays of numbers, and objects of those). */
function numeric(value: unknown): unknown {
  if (typeof value === 'number') return value;
  if (Array.isArray(value))
    return value.every((v) => typeof v === 'number') ? [...value] : undefined;
  if (isObject(value)) {
    const out: Json = {};
    for (const [k, v] of Object.entries(value)) {
      const n = numeric(v);
      if (n !== undefined) out[k] = n;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}

/** Ids and option numbers tie definitions to typed-array columns and cannot be configured. */
const PROTECTED = new Set(['id', 'option']);

const keyed = <T extends { key: string }>(items: readonly T[]): Json =>
  Object.fromEntries(
    items.map((item) => [
      item.key,
      numeric(Object.fromEntries(Object.entries(item).filter(([k]) => !PROTECTED.has(k)))),
    ]),
  );

/** The configuration as a JSON-friendly object: this is what `configs/default.json` contains. */
export function settingsToFile(settings: Settings): Json {
  return {
    units: numeric(settings.units),
    body: numeric(settings.body),
    activity: numeric(settings.activity),
    movement: numeric(settings.movement),
    injury: numeric(settings.injury),
    folk: {
      ...(numeric({ ...settings.folk, deciders: undefined }) as Json),
      deciders: [...settings.folk.deciders],
    },
    skills: numeric(settings.skills),
    goods: keyed(settings.goods),
    actions: keyed(settings.actions),
    species: keyed(settings.species),
    deciders: Object.fromEntries(
      settings.deciders.map((d) => [
        d.key,
        { params: Object.fromEntries(d.params.map((p) => [p.key, { min: p.min, max: p.max }])) },
      ]),
    ),
    ecology: numeric(settings.ecology),
    world: numeric(settings.world),
  };
}

/** Overlay numbers from `source` onto `target`, rejecting anything unknown or of the wrong kind. */
function apply(target: Json, source: unknown, path: string): void {
  if (!isObject(source)) throw new ConfigError(`${path} must be an object`);
  for (const [key, value] of Object.entries(source)) {
    const here = `${path}.${key}`;
    if (PROTECTED.has(key))
      throw new ConfigError(`${here} cannot be set from a configuration file`);
    if (!(key in target)) throw new ConfigError(`unknown setting ${here}`);
    const current = target[key];
    if (typeof current === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value))
        throw new ConfigError(`${here} must be a number`);
      target[key] = value;
    } else if (Array.isArray(current) && current.every((v) => typeof v === 'number')) {
      if (
        !Array.isArray(value) ||
        value.length !== current.length ||
        !value.every((v) => typeof v === 'number' && Number.isFinite(v))
      ) {
        throw new ConfigError(`${here} must be a list of ${current.length} numbers`);
      }
      target[key] = [...value];
    } else if (isObject(current)) {
      apply(current, value, here);
    } else {
      throw new ConfigError(`${here} cannot be set from a configuration file`);
    }
  }
}

/** Overlay a keyed collection (goods, actions, species) onto an array of definitions. */
function applyKeyed<T extends { key: string }>(items: T[], source: unknown, path: string): void {
  if (!isObject(source)) throw new ConfigError(`${path} must be an object keyed by name`);
  for (const [key, value] of Object.entries(source)) {
    const item = items.find((i) => i.key === key);
    if (!item) throw new ConfigError(`unknown entry ${path}.${key}`);
    apply(item as unknown as Json, value, `${path}.${key}`);
  }
}

function validate(settings: Settings): void {
  const positive = (value: number, name: string): void => {
    if (!(value > 0)) throw new ConfigError(`${name} must be greater than 0`);
  };
  positive(settings.body.reserveCapacity, 'body.reserveCapacity');
  positive(settings.body.baselineKcalPerTick, 'body.baselineKcalPerTick');
  positive(settings.body.maxIntakeKcalPerTick, 'body.maxIntakeKcalPerTick');
  positive(settings.body.mealKcal, 'body.mealKcal');
  positive(settings.folk.carryCapacityKg, 'folk.carryCapacityKg');
  positive(settings.folk.searchTicks, 'folk.searchTicks');
  positive(settings.folk.idleTicks, 'folk.idleTicks');
  positive(settings.folk.wanderRadius, 'folk.wanderRadius');
  positive(settings.movement.elevationRangeM, 'movement.elevationRangeM');
  if (!(settings.movement.slopeSlowdown >= 0))
    throw new ConfigError('movement.slopeSlowdown must be at least 0');
  if (!(settings.movement.climbKcalPerMeter >= 0)) {
    throw new ConfigError('movement.climbKcalPerMeter must be at least 0');
  }
  for (const [terrain, speed] of Object.entries(settings.movement.terrainSpeed)) {
    if (!(speed > 0 && speed <= 1)) {
      throw new ConfigError(`movement.terrainSpeed.${terrain} must be above 0 and at most 1`);
    }
  }
  if (!(settings.folk.interruptCooldown >= 0)) {
    throw new ConfigError('folk.interruptCooldown must be at least 0');
  }
  positive(settings.units.tickMinutes, 'units.tickMinutes');
  positive(settings.units.tileMeters, 'units.tileMeters');
  const { min, max } = settings.body.startReserveFraction;
  if (!(min > 0 && max >= min && max <= 1)) {
    throw new ConfigError('body.startReserveFraction needs 0 < min <= max <= 1');
  }
  if (!(Number.isInteger(settings.folk.count) && settings.folk.count >= 1)) {
    throw new ConfigError('folk.count must be a whole number of at least 1');
  }
  if (settings.folk.deciders.length === 0)
    throw new ConfigError('folk.deciders needs at least one decider');
  for (const key of settings.folk.deciders) {
    if (!DECIDERS.some((d) => d.key === key))
      throw new ConfigError(`folk.deciders has unknown decider "${key}"`);
  }
  for (const d of settings.deciders) {
    for (const p of d.params) {
      if (!(p.max >= p.min))
        throw new ConfigError(`deciders.${d.key}.params.${p.key}: max must be at least min`);
    }
  }
  for (const level of settings.injury.deathChancePerTick) {
    if (!(level >= 0 && level <= 1))
      throw new ConfigError('injury.deathChancePerTick values must be between 0 and 1');
  }
  if (settings.injury.durationMultiplier.some((m) => !(m >= 1))) {
    throw new ConfigError('injury.durationMultiplier values must be at least 1');
  }
  if (!(settings.ecology.plantRegrowthScale > 0)) {
    throw new ConfigError('ecology.plantRegrowthScale must be greater than 0');
  }
  if (!(settings.ecology.coverageScale > 0)) {
    throw new ConfigError('ecology.coverageScale must be greater than 0');
  }
  if (settings.ecology.separateAnimalFood !== 0 && settings.ecology.separateAnimalFood !== 1) {
    throw new ConfigError('ecology.separateAnimalFood must be 0 or 1');
  }
  const fill = settings.ecology.initialFill;
  if (!(fill.min >= 0 && fill.max >= fill.min && fill.max <= 1)) {
    throw new ConfigError('ecology.initialFill needs 0 <= min <= max <= 1');
  }
  for (const sp of settings.species) {
    const bad = (what: string): never => {
      throw new ConfigError(`species.${sp.key}.${what}`);
    };
    if (!(sp.coverage > 0 && sp.coverage <= 1)) bad('coverage must be above 0 and at most 1');
    if (!(sp.patchScale > 0)) bad('patchScale must be greater than 0');
    if (!(sp.patchRichness >= 0 && sp.patchRichness <= 1))
      bad('patchRichness must be between 0 and 1');
    if (!(sp.viability >= 0 && sp.viability < 1)) bad('viability must be at least 0 and below 1');
    if (!(sp.growthRate >= 0 && sp.seedRate >= 0 && sp.diffusionRate >= 0)) {
      bad('rates must not be negative');
    }
    if (!(sp.maxCapacity > 0)) bad('maxCapacity must be greater than 0');
  }
  if (!(Number.isInteger(settings.ecology.interval) && settings.ecology.interval >= 1)) {
    throw new ConfigError('ecology.interval must be a whole number of at least 1');
  }
}

/**
 * Turn a configuration file's contents into settings: defaults with the file's numbers laid over
 * them. Unknown names, wrong types and impossible values are rejected with the path of the problem.
 */
export function resolveSettings(file: unknown = {}): Settings {
  if (!isObject(file)) throw new ConfigError('the file must contain a JSON object');
  const settings = defaultSettings();
  const structural = settings as unknown as Json;
  for (const [key, value] of Object.entries(file)) {
    switch (key) {
      case 'goods':
        applyKeyed(settings.goods, value, 'goods');
        break;
      case 'actions':
        applyKeyed(settings.actions, value, 'actions');
        break;
      case 'species':
        applyKeyed(settings.species, value, 'species');
        break;
      case 'deciders': {
        if (!isObject(value)) throw new ConfigError('deciders must be an object keyed by decider');
        for (const [dk, dv] of Object.entries(value)) {
          const decider = settings.deciders.find((d) => d.key === dk);
          if (!decider) throw new ConfigError(`unknown decider deciders.${dk}`);
          if (!isObject(dv) || (Object.keys(dv).length > 0 && !('params' in dv))) {
            throw new ConfigError(`deciders.${dk} may only contain "params"`);
          }
          applyKeyed(decider.params, dv.params ?? {}, `deciders.${dk}.params`);
        }
        break;
      }
      case 'folk': {
        if (!isObject(value)) throw new ConfigError('folk must be an object');
        const { deciders, ...rest } = value;
        apply(settings.folk as unknown as Json, rest, 'folk');
        if (deciders !== undefined) {
          if (!Array.isArray(deciders) || !deciders.every((d) => typeof d === 'string')) {
            throw new ConfigError('folk.deciders must be a list of decider names');
          }
          settings.folk.deciders = [...deciders];
        }
        break;
      }
      default:
        if (!(key in structural) || !isObject(structural[key]))
          throw new ConfigError(`unknown section "${key}"`);
        apply(structural[key] as Json, value, key);
    }
  }
  validate(settings);
  return settings;
}

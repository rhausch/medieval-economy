import type {
  ActivityRow,
  ConsumptionRow,
  LedgerRow,
  SimEvent,
  SourceRow,
  WorldParams,
  TravelRow,
} from '@folk/sim';

export interface TerrainInfo {
  id: number;
  key: string;
  name: string;
  color: number;
}

export interface DeciderInfo {
  key: string;
  name: string;
  color: number;
  params: { key: string; label: string; min: number; max: number }[];
}

export interface SpeciesInfo {
  id: number;
  key: string;
  name: string;
  kind: 'plant' | 'animal';
  color: number;
  maxCapacity: number;
  /** True if Folk can gather or hunt it (false for the forage layer animals graze). */
  food: boolean;
}

/** Sent as JSON, immediately followed by one binary frame: terrain ids then 8-bit elevation. */
export interface WorldMessage {
  type: 'world';
  params: WorldParams;
  terrain: TerrainInfo[];
  species: SpeciesInfo[];
  deciders: DeciderInfo[];
  /** Calorie reserve capacity and baseline burn per tick. */
  body: { capacity: number; baseline: number };
  /** The ecology settings the world is running with. */
  ecology: { plantRegrowthScale: number; coverageScale: number; separateAnimalFood: number };
  /** Fingerprint of the run's configuration (see the manifest for the full settings). */
  settingsHash: string;
  /** Plant regrowth relative to the default (below 1 means scarcer food). */
  plantRegrowthScale: number;
}

/**
 * Sent as JSON, immediately followed by one binary frame holding, for each species in order,
 * one byte per tile: 0 = uninhabitable, else 1 + round(254 * stock / species.maxCapacity).
 */
export interface ResourcesMessage {
  type: 'resources';
  tick: number;
  /** Total stock per species across the world. */
  totals: number[];
}

export interface TimingInfo {
  p50Us: number;
  p95Us: number;
  p99Us: number;
  maxUs: number;
}

/** Sent about once a second: performance, and the running totals used for tuning. */
export interface StatsMessage {
  type: 'stats';
  tick: number;
  /** Null unless the sim is being timed. Rates cover the time since the previous message. */
  perf: {
    ticksPerSecond: number;
    msPerTick: number;
    ecologyMsPerTick: number;
    folkMsPerTick: number;
    decisionsPerTick: number;
    /** Decision timings cover the whole run so far. */
    scan: TimingInfo;
    deciders: ({ key: string; decisions: number } & TimingInfo)[];
  } | null;
  /** Stock and capacity of every species on every terrain type. */
  terrains: {
    terrain: string;
    tiles: number;
    species: {
      key: string;
      habitable: number;
      depleted: number;
      stock: number;
      capacity: number;
    }[];
  }[];
  /** Units of each good currently carried by Folk. */
  carried: Record<string, number>;
  /** Cumulative since the run began. */
  activity: ActivityRow[];
  ledger: LedgerRow[];
  travel: TravelRow[];
  sources: SourceRow[];
  consumption: ConsumptionRow[];
}

export interface TickMessage {
  type: 'tick';
  tick: number;
  paused: boolean;
  speed: number;
}

export interface TileResource {
  key: string;
  name: string;
  kind: 'plant' | 'animal';
  stock: number;
  capacity: number;
}

export interface TileMessage {
  type: 'tile';
  x: number;
  y: number;
  terrain: string;
  category: string;
  walkable: boolean;
  elevation: number;
  moisture: number;
  resources: TileResource[];
}

export interface FolkInfo {
  id: number;
  x: number;
  y: number;
  action: string;
  /** Calories in the reserve. */
  reserve: number;
  /** Decider key and its map color. */
  decider: string;
  color: number;
  /** 0 none, 1 minor, 2 serious. */
  injury: number;
}

/** Positions and needs of every Folk, sent every tick. */
export interface FolkMessage {
  type: 'folk';
  tick: number;
  folk: FolkInfo[];
}

export interface FolkDetailMessage {
  type: 'folkDetail';
  /** Requested id; `found` is false when that Folk no longer exists (e.g. it died). */
  id: number;
  found: boolean;
  folk?: FolkInfo & {
    age: number;
    foraging: number;
    hunting: number;
    inventory: { key: string; name: string; kg: number; kcal: number }[];
    carriedKg: number;
    capacityKg: number;
    /** Calories burned per tick right now (baseline, current activity and healing). */
    burnNow: number;
    /** Lifetime calories eaten and burned, and meals eaten. */
    kcalEaten: number;
    kcalSpent: number;
    meals: number;
    /** The decider's parameter array with each parameter's allowed range. */
    params: { key: string; label: string; value: number; min: number; max: number }[];
    injuryName: string;
    /** Ticks until the injury heals one level (0 if uninjured). */
    injuryRemaining: number;
    /** The goal on the Folk's blackboard, and the path it still has to walk (null when it has none). */
    goal: {
      option: string;
      targetX: number;
      targetY: number;
      /** Ticks since the goal was chosen, and steps of the path still to walk. */
      age: number;
      stepsLeft: number;
      path: { x: number; y: number }[];
    } | null;
    /** What the last decision chose, and the score of each option it could pick (utility only). */
    chosen: string;
    scores: { option: string; score: number }[];
  };
  /** Most recent events involving this Folk, oldest first. */
  events: SimEvent[];
}

/** Messages the server sends to clients (binary data follows a WorldMessage or ResourcesMessage). */
export type ServerMessage =
  | WorldMessage
  | ResourcesMessage
  | TickMessage
  | StatsMessage
  | TileMessage
  | FolkMessage
  | FolkDetailMessage;

/** Messages clients send to the server. */
export type ClientMessage =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'speed'; speed: number }
  | { type: 'subscribe'; resources: boolean }
  | {
      type: 'generate';
      params: Partial<WorldParams> & {
        plantRegrowthScale?: number;
        coverageScale?: number;
        separateAnimalFood?: number;
      };
    }
  | { type: 'inspect'; x: number; y: number }
  | { type: 'inspectFolk'; id: number };

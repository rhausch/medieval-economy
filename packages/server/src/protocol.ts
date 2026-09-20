import type { SimEvent, WorldParams } from '@folk/sim';

export interface TerrainInfo {
  id: number;
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
}

/** Sent as JSON, immediately followed by one binary frame: terrain ids then 8-bit elevation. */
export interface WorldMessage {
  type: 'world';
  params: WorldParams;
  terrain: TerrainInfo[];
  species: SpeciesInfo[];
  deciders: DeciderInfo[];
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
  satiety: number;
  health: number;
  energy: number;
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
    inventory: { key: string; name: string; amount: number }[];
    carried: number;
    capacity: number;
    /** The decider's parameter array with each parameter's allowed range. */
    params: { key: string; label: string; value: number; min: number; max: number }[];
    injuryName: string;
    /** Ticks until the injury heals one level (0 if uninjured). */
    injuryRemaining: number;
    /** What the last decision chose, and the score of each option it could pick (utility only). */
    chosen: string;
    scores: { option: string; score: number }[];
  };
  /** Most recent events involving this Folk, oldest first. */
  events: SimEvent[];
}

/** Messages the server sends to clients (binary data follows a WorldMessage or ResourcesMessage). */
export type ServerMessage =
  WorldMessage | ResourcesMessage | TickMessage | TileMessage | FolkMessage | FolkDetailMessage;

/** Messages clients send to the server. */
export type ClientMessage =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'speed'; speed: number }
  | { type: 'subscribe'; resources: boolean }
  | { type: 'generate'; params: Partial<WorldParams> & { plantRegrowthScale?: number } }
  | { type: 'inspect'; x: number; y: number }
  | { type: 'inspectFolk'; id: number };

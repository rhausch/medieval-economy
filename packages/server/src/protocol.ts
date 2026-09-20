import type { SimEvent, WorldParams } from '@folk/sim';

export interface TerrainInfo {
  id: number;
  name: string;
  color: number;
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
  | { type: 'generate'; params: Partial<WorldParams> }
  | { type: 'inspect'; x: number; y: number }
  | { type: 'inspectFolk'; id: number };

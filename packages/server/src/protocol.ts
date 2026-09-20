import type { WorldParams } from '@folk/sim';

export interface TerrainInfo {
  id: number;
  name: string;
  color: number;
}

/** Sent as JSON, immediately followed by one binary frame: terrain ids then 8-bit elevation. */
export interface WorldMessage {
  type: 'world';
  params: WorldParams;
  terrain: TerrainInfo[];
}

export interface TickMessage {
  type: 'tick';
  tick: number;
  paused: boolean;
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
}

/** Messages the server sends to clients (binary world data follows a WorldMessage). */
export type ServerMessage = WorldMessage | TickMessage | TileMessage;

/** Messages clients send to the server. */
export type ClientMessage =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'generate'; params: Partial<WorldParams> }
  | { type: 'inspect'; x: number; y: number };

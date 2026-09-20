import type {
  ClientMessage,
  ResourcesMessage,
  ServerMessage,
  WorldMessage,
} from '../../packages/server/src/protocol';

export type {
  DeciderInfo,
  FolkDetailMessage,
  FolkInfo,
  FolkMessage,
  SpeciesInfo,
  TerrainInfo,
  TickMessage,
  TileMessage,
  WorldMessage,
} from '../../packages/server/src/protocol';

export interface WorldData {
  meta: WorldMessage;
  terrain: Uint8Array;
  /** Elevation quantized to 0..255. */
  elevation: Uint8Array;
}

export interface ResourceData {
  meta: ResourcesMessage;
  /** One array per species: 0 = uninhabitable, else 1 + round(254 * stock / maxCapacity). */
  frames: Uint8Array[];
}

export interface NetHandlers {
  onOpen(): void;
  onClose(): void;
  onMessage(msg: Exclude<ServerMessage, WorldMessage | ResourcesMessage>): void;
  onWorld(world: WorldData): void;
  onResources(resources: ResourceData): void;
}

export interface Connection {
  send(msg: ClientMessage): void;
}

export function connect(url: string, handlers: NetHandlers): Connection {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  let pending: WorldMessage | ResourcesMessage | null = null;
  let tiles = 0;
  let speciesCount = 0;

  socket.addEventListener('open', () => handlers.onOpen());
  socket.addEventListener('close', () => handlers.onClose());
  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') {
      const header = pending;
      pending = null;
      if (!header) return;
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      if (header.type === 'world') {
        tiles = header.params.width * header.params.height;
        speciesCount = header.species.length;
        handlers.onWorld({
          meta: header,
          terrain: bytes.subarray(0, tiles),
          elevation: bytes.subarray(tiles, 2 * tiles),
        });
      } else if (bytes.length === tiles * speciesCount) {
        const frames = Array.from({ length: speciesCount }, (_, s) =>
          bytes.subarray(s * tiles, (s + 1) * tiles),
        );
        handlers.onResources({ meta: header, frames });
      }
      return;
    }
    const msg = JSON.parse(event.data) as ServerMessage;
    if (msg.type === 'world' || msg.type === 'resources') pending = msg;
    else handlers.onMessage(msg);
  });

  return { send: (msg) => socket.send(JSON.stringify(msg)) };
}

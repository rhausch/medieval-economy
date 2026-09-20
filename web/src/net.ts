import type {
  ClientMessage,
  ServerMessage,
  WorldMessage,
} from '../../packages/server/src/protocol';

export type { TerrainInfo, TileMessage, WorldMessage } from '../../packages/server/src/protocol';

export interface WorldData {
  meta: WorldMessage;
  terrain: Uint8Array;
  /** Elevation quantized to 0..255. */
  elevation: Uint8Array;
}

export interface NetHandlers {
  onOpen(): void;
  onClose(): void;
  onMessage(msg: Exclude<ServerMessage, WorldMessage>): void;
  onWorld(world: WorldData): void;
}

export interface Connection {
  send(msg: ClientMessage): void;
}

export function connect(url: string, handlers: NetHandlers): Connection {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  let pending: WorldMessage | null = null;

  socket.addEventListener('open', () => handlers.onOpen());
  socket.addEventListener('close', () => handlers.onClose());
  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') {
      if (!pending) return;
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      const n = pending.params.width * pending.params.height;
      handlers.onWorld({
        meta: pending,
        terrain: bytes.subarray(0, n),
        elevation: bytes.subarray(n, 2 * n),
      });
      pending = null;
      return;
    }
    const msg = JSON.parse(event.data) as ServerMessage;
    if (msg.type === 'world') pending = msg;
    else handlers.onMessage(msg);
  });

  return { send: (msg) => socket.send(JSON.stringify(msg)) };
}

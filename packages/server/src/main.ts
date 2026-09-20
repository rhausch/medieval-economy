import { WebSocketServer, type WebSocket } from 'ws';
import { createSim, terrainById, TERRAIN_LIST, type Sim, type WorldParams } from '@folk/sim';
import type { ClientMessage, ServerMessage } from './protocol';

const PORT = Number(process.env.PORT ?? 8787);
const TICK_MS = 100;
const MAX_TILES = 4096 * 4096;

let sim: Sim = createSim({ seed: Number(process.env.SEED ?? 1) });
let paused = false;

const wss = new WebSocketServer({ port: PORT });
const clients = new Set<WebSocket>();

function tickMessage(): ServerMessage {
  return { type: 'tick', tick: sim.tick, paused };
}

function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const client of clients) client.send(data);
}

function sendWorld(socket: WebSocket): void {
  const { world } = sim;
  const meta: ServerMessage = {
    type: 'world',
    params: world.params,
    terrain: TERRAIN_LIST.map((t) => ({ id: t.id, name: t.name, color: t.color })),
  };
  const n = world.width * world.height;
  const payload = new Uint8Array(n * 2);
  payload.set(world.terrain, 0);
  for (let i = 0; i < n; i++) payload[n + i] = Math.round(world.elevation[i]! * 255);
  socket.send(JSON.stringify(meta));
  socket.send(payload);
}

function sendTile(socket: WebSocket, x: number, y: number): void {
  const { world } = sim;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return;
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return;
  const i = y * world.width + x;
  const def = terrainById(world.terrain[i]!);
  const msg: ServerMessage = {
    type: 'tile',
    x,
    y,
    terrain: def.name,
    category: def.category,
    walkable: def.walkable,
    elevation: world.elevation[i]!,
    moisture: world.moisture[i]!,
  };
  socket.send(JSON.stringify(msg));
}

function regenerate(params: Partial<WorldParams>): void {
  const width = Math.floor(Number(params.width ?? sim.world.width));
  const height = Math.floor(Number(params.height ?? sim.world.height));
  if (!(width >= 8 && height >= 8 && width * height <= MAX_TILES)) return;
  sim = createSim({
    seed: Number(params.seed ?? sim.config.seed),
    world: { ...params, width, height },
  });
  for (const client of clients) sendWorld(client);
  broadcast(tickMessage());
}

wss.on('connection', (socket) => {
  clients.add(socket);
  sendWorld(socket);
  socket.send(JSON.stringify(tickMessage()));
  socket.on('close', () => clients.delete(socket));
  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'pause':
        paused = true;
        broadcast(tickMessage());
        break;
      case 'resume':
        paused = false;
        broadcast(tickMessage());
        break;
      case 'generate':
        regenerate(msg.params ?? {});
        break;
      case 'inspect':
        sendTile(socket, msg.x, msg.y);
        break;
    }
  });
});

setInterval(() => {
  if (paused) return;
  sim.step();
  broadcast(tickMessage());
}, TICK_MS);

console.log(`sim server listening on ws://localhost:${PORT}`);

import { WebSocketServer, type WebSocket } from 'ws';
import { startRun, type RunLogger } from '@folk/runlog';
import {
  createSim,
  FOLK,
  GOODS_LIST,
  FOLK_ACTIONS,
  type SimEvent,
  speciesTotals,
  SPECIES_LIST,
  terrainById,
  TERRAIN_LIST,
  type Sim,
  type WorldParams,
} from '@folk/sim';
import type { ClientMessage, FolkInfo, ServerMessage } from './protocol';

const PORT = Number(process.env.PORT ?? 8787);
const TICK_MS = 100;
const RESOURCE_MS = 250;
const MAX_TILES = 4096 * 4096;
const SPEEDS = [1, 2, 5, 10, 20];

let sim: Sim = createSim({ seed: Number(process.env.SEED ?? 1) });
let paused = false;
let speed = 1;

let logger: RunLogger = beginRun(sim);
/** Last few events per Folk id, for the inspector. */
const recentEvents = new Map<number, SimEvent[]>();
const RECENT_PER_FOLK = 12;
const RECENT_MAX_FOLK = 500;

function beginRun(target: Sim): RunLogger {
  const run = startRun(target, { extra: { decider: 'rules', source: 'server' } });
  console.log(`logging run to ${run.dir}`);
  return run;
}

/** Record the sim state, write its events to the run log, and remember them for the inspector. */
function record(): void {
  for (const event of logger.record(sim)) {
    const list = recentEvents.get(event.folk) ?? [];
    list.push(event);
    if (list.length > RECENT_PER_FOLK) list.shift();
    recentEvents.set(event.folk, list);
  }
  if (recentEvents.size > RECENT_MAX_FOLK) {
    const oldest = recentEvents.keys().next().value;
    if (oldest !== undefined) recentEvents.delete(oldest);
  }
}
record();

const wss = new WebSocketServer({ port: PORT });
const clients = new Set<WebSocket>();
const wantsResources = new Set<WebSocket>();

function tickMessage(): ServerMessage {
  return { type: 'tick', tick: sim.tick, paused, speed };
}

function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const client of clients) client.send(data);
}

function folkInfo(slot: number): FolkInfo {
  const f = sim.folk;
  return {
    id: f.id[slot]!,
    x: f.x[slot]!,
    y: f.y[slot]!,
    action: FOLK_ACTIONS[f.action[slot]!] ?? 'idle',
    satiety: f.satiety[slot]!,
    health: f.health[slot]!,
    energy: f.energy[slot]!,
  };
}

function folkMessage(): ServerMessage {
  return {
    type: 'folk',
    tick: sim.tick,
    folk: Array.from({ length: sim.folk.count }, (_, slot) => folkInfo(slot)),
  };
}

function sendFolkDetail(socket: WebSocket, id: number): void {
  const f = sim.folk;
  const slot = f.id.indexOf(id);
  const events = recentEvents.get(id) ?? [];
  if (slot < 0) {
    socket.send(
      JSON.stringify({ type: 'folkDetail', id, found: false, events } satisfies ServerMessage),
    );
    return;
  }
  const perGood = GOODS_LIST.length;
  const inventory = GOODS_LIST.map((g, k) => ({
    key: g.key,
    name: g.name,
    amount: f.inventory[slot * perGood + k]!,
  }));
  const msg: ServerMessage = {
    type: 'folkDetail',
    id,
    found: true,
    folk: {
      ...folkInfo(slot),
      age: f.age[slot]!,
      foraging: f.foraging[slot]!,
      hunting: f.hunting[slot]!,
      inventory,
      carried: inventory.reduce((sum, item, k) => sum + item.amount * GOODS_LIST[k]!.weight, 0),
      capacity: FOLK.carryCapacity,
    },
    events,
  };
  socket.send(JSON.stringify(msg));
}

function sendWorld(socket: WebSocket): void {
  const { world } = sim;
  const meta: ServerMessage = {
    type: 'world',
    params: world.params,
    terrain: TERRAIN_LIST.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    species: SPECIES_LIST.map((s) => ({
      id: s.id,
      key: s.key,
      name: s.name,
      kind: s.kind,
      color: s.color,
      maxCapacity: s.maxCapacity,
    })),
  };
  const n = world.width * world.height;
  const payload = new Uint8Array(n * 2);
  payload.set(world.terrain, 0);
  for (let i = 0; i < n; i++) payload[n + i] = Math.round(world.elevation[i]! * 255);
  socket.send(JSON.stringify(meta));
  socket.send(payload);
}

function sendResources(sockets: Iterable<WebSocket>): void {
  const targets = [...sockets];
  if (targets.length === 0) return;
  const { ecology, world } = sim;
  const n = world.width * world.height;
  const payload = new Uint8Array(n * ecology.species.length);
  ecology.species.forEach((def, s) => {
    const stock = ecology.stock[s]!;
    const cap = ecology.capacity[s]!;
    const base = s * n;
    for (let i = 0; i < n; i++) {
      payload[base + i] =
        cap[i] === 0 ? 0 : 1 + Math.round(254 * Math.min(1, stock[i]! / def.maxCapacity));
    }
  });
  const meta: ServerMessage = { type: 'resources', tick: sim.tick, totals: speciesTotals(ecology) };
  const json = JSON.stringify(meta);
  for (const socket of targets) {
    socket.send(json);
    socket.send(payload);
  }
}

function sendTile(socket: WebSocket, x: number, y: number): void {
  const { world, ecology } = sim;
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
    resources: ecology.species
      .map((s, k) => ({
        key: s.key,
        name: s.name,
        kind: s.kind,
        stock: ecology.stock[k]![i]!,
        capacity: ecology.capacity[k]![i]!,
      }))
      .filter((r) => r.capacity > 0),
  };
  socket.send(JSON.stringify(msg));
}

function regenerate(params: Partial<WorldParams>): void {
  const width = Math.floor(Number(params.width ?? sim.world.width));
  const height = Math.floor(Number(params.height ?? sim.world.height));
  if (!(width >= 8 && height >= 8 && width * height <= MAX_TILES)) return;
  logger.close(sim);
  sim = createSim({
    seed: Number(params.seed ?? sim.config.seed),
    world: { ...params, width, height },
  });
  logger = beginRun(sim);
  recentEvents.clear();
  record();
  for (const client of clients) sendWorld(client);
  sendResources(wantsResources);
  broadcast(tickMessage());
  broadcast(folkMessage());
}

wss.on('connection', (socket) => {
  clients.add(socket);
  sendWorld(socket);
  socket.send(JSON.stringify(tickMessage()));
  socket.send(JSON.stringify(folkMessage()));
  socket.on('close', () => {
    clients.delete(socket);
    wantsResources.delete(socket);
  });
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
      case 'speed':
        if (SPEEDS.includes(msg.speed)) speed = msg.speed;
        broadcast(tickMessage());
        break;
      case 'subscribe':
        if (msg.resources) {
          wantsResources.add(socket);
          sendResources([socket]);
        } else {
          wantsResources.delete(socket);
        }
        break;
      case 'generate':
        regenerate(msg.params ?? {});
        break;
      case 'inspect':
        sendTile(socket, msg.x, msg.y);
        break;
      case 'inspectFolk':
        sendFolkDetail(socket, Number(msg.id));
        break;
    }
  });
});

setInterval(() => {
  if (paused) return;
  for (let i = 0; i < speed; i++) {
    sim.step();
    record();
  }
  broadcast(tickMessage());
  broadcast(folkMessage());
}, TICK_MS);

setInterval(() => {
  if (!paused) sendResources(wantsResources);
}, RESOURCE_MS);

console.log(`sim server listening on ws://localhost:${PORT}`);

/** Flush the run log before exiting so a stopped or restarted server never loses data. */
function shutdown(): void {
  logger.close(sim);
  for (const client of clients) client.terminate();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

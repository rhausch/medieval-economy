import { WebSocketServer, type WebSocket } from 'ws';
import { hashSettings, loadSettings, startRun, type RunLogger } from '@folk/runlog';
import {
  activityRows,
  carriedTotals,
  consumptionRows,
  sourceRows,
  terrainResources,
  createSim,
  DECIDERS,
  INJURY_NAMES,
  ledgerRows,
  folkCounters,
  type Settings,
  OPTION_COUNT,
  OPTION_NAMES,
  FOLK_ACTIONS,
  MAX_PARAMS,
  type SimEvent,
  speciesTotals,
  terrainById,
  TERRAIN_LIST,
  type Sim,
  type WorldParams,
} from '@folk/sim';
import type { ClientMessage, FolkInfo, ServerMessage, StatsMessage, TimingInfo } from './protocol';

const PORT = Number(process.env.PORT ?? 8787);
const TICK_MS = 100;
const RESOURCE_MS = 250;
const STATS_MS = 1000;
const MAX_TILES = 4096 * 4096;
const SPEEDS = [1, 2, 5, 10, 20];

/** The run configuration: a file named by CONFIG, or the built-in defaults. */
const configPath = process.env.CONFIG ?? null;
let settings: Settings | undefined;
try {
  settings = configPath ? loadSettings(configPath) : undefined;
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
let plantRegrowthScale = process.env.REGROWTH
  ? Number(process.env.REGROWTH)
  : (settings?.ecology.plantRegrowthScale ?? 1);
const timer = (): number => performance.now();
let sim: Sim = createSim({
  seed: Number(process.env.SEED ?? 1),
  settings,
  plantRegrowthScale,
  timer,
});

let paused = false;
let speed = 1;

let logger: RunLogger = beginRun(sim);
/** Last few events per Folk id, for the inspector. */
const recentEvents = new Map<number, SimEvent[]>();
const RECENT_PER_FOLK = 12;
const RECENT_MAX_FOLK = 500;

function beginRun(target: Sim): RunLogger {
  const run = startRun(target, { configPath, extra: { source: 'server' } });
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
    reserve: f.reserve[slot]!,
    decider: DECIDERS[f.decider[slot]!]!.key,
    color: DECIDERS[f.decider[slot]!]!.color,
    injury: f.injury[slot]!,
  };
}

function folkMessage(): ServerMessage {
  return {
    type: 'folk',
    tick: sim.tick,
    folk: Array.from({ length: sim.folk.count }, (_, slot) => folkInfo(slot)),
  };
}

/** Which foraging action key each work label in FOLK_ACTIONS comes from. */
const ACTION_FOR_LABEL: Record<string, string> = {
  gathering: 'gather',
  digging: 'dig',
  snaring: 'snare',
  chasing: 'chase',
};

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
  const { goods, body, injury, activity } = sim.settings;
  const inventory = goods.map((g, k) => ({
    key: g.key,
    name: g.name,
    kg: f.inventory[slot * goods.length + k]!,
    kcal: f.inventory[slot * goods.length + k]! * (g.edible ? g.kcalPerKg : 0),
  }));
  const counters = folkCounters(sim.metrics, slot);
  const level = f.injury[slot]!;
  const action = FOLK_ACTIONS[f.action[slot]!] ?? 'idle';
  const actionCost =
    action === 'idle' || action === 'moving' || action === 'eating' || action === 'resting'
      ? activity[action]
      : (sim.settings.actions.find((a) => a.key === ACTION_FOR_LABEL[action])?.kcalPerTick ?? 0);
  const deciderSettings = sim.settings.deciders[f.decider[slot]!]!;
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
      carriedKg: inventory.reduce((sum, item) => sum + item.kg, 0),
      capacityKg: sim.settings.folk.carryCapacityKg,
      burnNow:
        body.baselineKcalPerTick + actionCost + (level > 0 ? injury.healKcalPerTick[level]! : 0),
      kcalEaten: counters.kcalEaten!,
      kcalSpent: counters.kcalSpent!,
      meals: counters.meals!,
      params: deciderSettings.params.map((spec, i) => ({
        key: spec.key,
        label: spec.label,
        value: f.params[slot * MAX_PARAMS + i]!,
        min: spec.min,
        max: spec.max,
      })),
      injuryName: INJURY_NAMES[level] ?? 'none',
      injuryRemaining: f.injury[slot]! > 0 ? Math.max(0, f.injuryTimer[slot]!) : 0,
      chosen: OPTION_NAMES[f.choice[slot]!] ?? 'wander',
      scores: OPTION_NAMES.map((option, k) => ({
        option,
        score: f.scores[slot * OPTION_COUNT + k]!,
      })).filter((entry) => !Number.isNaN(entry.score)),
    },
    events,
  };
  socket.send(JSON.stringify(msg));
}

/** Totals at the previous stats message, so rates can be reported for the interval in between. */
let lastStats: {
  wall: number;
  ticks: number;
  stepMs: number;
  ecologyMs: number;
  folkMs: number;
  decisions: number;
} | null = null;

const micros = (ms: number): number => ms * 1000;
const timingInfo = (stat: { quantileMs(q: number): number; maxMs: number }): TimingInfo => ({
  p50Us: micros(stat.quantileMs(0.5)),
  p95Us: micros(stat.quantileMs(0.95)),
  p99Us: micros(stat.quantileMs(0.99)),
  maxUs: micros(stat.maxMs),
});

function buildStats(): StatsMessage {
  const { perf, world, ecology } = sim;
  let perfInfo: StatsMessage['perf'] = null;
  if (perf) {
    const decisions = perf.decide.reduce((sum, s) => sum + s.count, 0);
    const now = performance.now();
    const previous = lastStats;
    const ticks = perf.step.count - (previous?.ticks ?? 0);
    const wall = now - (previous?.wall ?? now);
    if (previous && ticks > 0) {
      perfInfo = {
        ticksPerSecond: wall > 0 ? (ticks * 1000) / wall : 0,
        msPerTick: (perf.step.totalMs - previous.stepMs) / ticks,
        ecologyMsPerTick: (perf.ecology.totalMs - previous.ecologyMs) / ticks,
        folkMsPerTick: (perf.folk.totalMs - previous.folkMs) / ticks,
        decisionsPerTick: (decisions - previous.decisions) / ticks,
        scan: timingInfo(perf.scan),
        deciders: DECIDERS.map((d, i) => ({
          key: d.key,
          decisions: perf.decide[i]!.count,
          ...timingInfo(perf.decide[i]!),
        })),
      };
    }
    lastStats = {
      wall: now,
      ticks: perf.step.count,
      stepMs: perf.step.totalMs,
      ecologyMs: perf.ecology.totalMs,
      folkMs: perf.folk.totalMs,
      decisions,
    };
  }
  const rows = terrainResources(world, ecology);
  const terrains = TERRAIN_LIST.map((t) => {
    const mine = rows.filter((r) => r.terrain === t.key);
    return {
      terrain: t.name,
      tiles: mine[0]?.tiles ?? 0,
      species: mine.map((r) => ({
        key: r.species,
        habitable: r.habitable,
        stock: r.stock,
        capacity: r.capacity,
      })),
    };
  });
  return {
    type: 'stats',
    tick: sim.tick,
    perf: perfInfo,
    terrains,
    carried: carriedTotals(sim.folk),
    activity: activityRows(sim.metrics),
    ledger: ledgerRows(sim.metrics),
    sources: sourceRows(sim.metrics),
    consumption: consumptionRows(sim.metrics),
  };
}

function sendWorld(socket: WebSocket): void {
  const { world } = sim;
  const meta: ServerMessage = {
    type: 'world',
    params: world.params,
    terrain: TERRAIN_LIST.map((t) => ({ id: t.id, key: t.key, name: t.name, color: t.color })),
    deciders: DECIDERS.map((d, i) => ({
      key: d.key,
      name: d.name,
      color: d.color,
      params: [...sim.settings.deciders[i]!.params],
    })),
    body: {
      capacity: sim.settings.body.reserveCapacity,
      baseline: sim.settings.body.baselineKcalPerTick,
    },
    settingsHash: hashSettings(sim.settings),
    plantRegrowthScale,
    species: sim.settings.species.map((s) => ({
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

function regenerate(params: Partial<WorldParams> & { plantRegrowthScale?: number }): void {
  const width = Math.floor(Number(params.width ?? sim.world.width));
  const height = Math.floor(Number(params.height ?? sim.world.height));
  if (!(width >= 8 && height >= 8 && width * height <= MAX_TILES)) return;
  logger.close(sim);
  const { plantRegrowthScale: scale, ...world } = params;
  if (scale !== undefined && Number.isFinite(Number(scale)) && Number(scale) > 0) {
    plantRegrowthScale = Number(scale);
  }
  sim = createSim({
    seed: Number(params.seed ?? sim.config.seed),
    settings,
    plantRegrowthScale,
    timer,
    world: { ...world, width, height },
  });
  lastStats = null;
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

setInterval(() => {
  if (!paused && clients.size > 0) broadcast(buildStats());
}, STATS_MS);

console.log(`sim server listening on ws://localhost:${PORT}`);

/** Flush the run log before exiting so a stopped or restarted server never loses data. */
function shutdown(): void {
  logger.close(sim);
  for (const client of clients) client.terminate();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

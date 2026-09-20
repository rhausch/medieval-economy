import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  COUNTER_NAMES,
  DECIDERS,
  FOLK_ACTIONS,
  FORAGE_ACTIONS,
  GOODS_LIST,
  INJURY,
  MAX_PARAMS,
  SPECIES_LIST,
  activityRows,
  carriedTotals,
  consumptionRows,
  folkCounters,
  sourceRows,
  speciesTotals,
  summarize,
  terrainResources,
  type Sim,
  type SimEvent,
} from '@folk/sim';

const FLUSH_BYTES = 64 * 1024;

export interface RunLoggerOptions {
  /** Directory that holds one folder per run (default: <repo>/experiments/output). */
  outputDir?: string;
  /** Write an entity and resource snapshot every N ticks (default 10). */
  snapshotInterval?: number;
  /** Write the heavier metrics (terrain food, activity, food sources) every N ticks (default 100). */
  metricsInterval?: number;
  /** Extra fields recorded in the manifest (e.g. which decider was used). */
  extra?: Record<string, unknown>;
}

export interface RunLogger {
  readonly dir: string;
  readonly runId: string;
  /**
   * Call once after creating the sim (records tick 0) and once after every step.
   * Drains and writes the sim's events, writes a snapshot on the interval, and returns the events.
   */
  record(sim: Sim): SimEvent[];
  /** Flush everything and finalize the manifest. */
  close(sim: Sim): void;
}

export function defaultOutputDir(): string {
  return fileURLToPath(new URL('../../../experiments/output', import.meta.url));
}

function gitInfo(): { commit: string | null; dirty: boolean | null } {
  try {
    const run = (args: string[]): string =>
      execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { commit: run(['rev-parse', 'HEAD']), dirty: run(['status', '--porcelain']).length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
}

function stamp(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

class Buffered {
  private chunks: string[] = [];
  private size = 0;
  private readonly fd: number;
  constructor(path: string, header?: string) {
    this.fd = openSync(path, 'w');
    if (header) this.write(header + '\n');
  }
  write(text: string): void {
    this.chunks.push(text);
    this.size += text.length;
    if (this.size >= FLUSH_BYTES) this.flush();
  }
  flush(): void {
    if (this.chunks.length === 0) return;
    writeSync(this.fd, this.chunks.join(''));
    this.chunks = [];
    this.size = 0;
  }
  close(): void {
    this.flush();
    closeSync(this.fd);
  }
}

/** Start logging a run to its own folder: manifest.json, events.jsonl, entities.csv, resources.csv. */
export function startRun(sim: Sim, options: RunLoggerOptions = {}): RunLogger {
  const outputDir = options.outputDir ?? defaultOutputDir();
  const snapshotInterval = Math.max(1, Math.floor(options.snapshotInterval ?? 10));
  const metricsInterval = Math.max(1, Math.floor(options.metricsInterval ?? 100));
  const startedAt = new Date();
  const runId = `${stamp(startedAt)}-seed${sim.config.seed}`;
  mkdirSync(outputDir, { recursive: true });
  // Two runs can start in the same second (e.g. regenerating); never share a folder.
  let dir = join(outputDir, runId);
  for (let n = 2; ; n++) {
    try {
      mkdirSync(dir);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      dir = join(outputDir, `${runId}-${n}`);
    }
  }
  const id = dir.slice(outputDir.length + 1);

  const manifestPath = join(dir, 'manifest.json');
  const manifest = {
    runId: id,
    startedAt: startedAt.toISOString(),
    endedAt: null as string | null,
    ticks: 0,
    seed: sim.config.seed,
    world: sim.world.params,
    ecologyInterval: sim.config.ecologyInterval ?? 1,
    plantRegrowthScale: sim.config.plantRegrowthScale ?? 1,
    folkCount: sim.folk.count,
    emitMoves: sim.config.emitMoves ?? false,
    snapshotInterval,
    metricsInterval,
    timed: sim.perf !== null,
    species: SPECIES_LIST.map((s) => s.key),
    deciders: DECIDERS.map((d) => ({ key: d.key, params: d.params })),
    deciderMix: sim.config.deciders ?? DECIDERS.map((d) => d.key),
    actions: FORAGE_ACTIONS,
    injury: INJURY,
    goods: GOODS_LIST.map((g) => g.key),
    settlement: sim.folk.settlement,
    git: gitInfo(),
    node: process.version,
    ...options.extra,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const events = new Buffered(join(dir, 'events.jsonl'));
  const entities = new Buffered(
    join(dir, 'entities.csv'),
    'tick,id,x,y,satiety,health,energy,age,action,decider,injury,foraging,hunting' +
      GOODS_LIST.map((g) => `,inv_${g.key}`).join(''),
  );
  const resources = new Buffered(
    join(dir, 'resources.csv'),
    ['tick', ...SPECIES_LIST.map((s) => s.key), ...GOODS_LIST.map((g) => `carried_${g.key}`)].join(
      ',',
    ),
  );
  const terrainRes = new Buffered(
    join(dir, 'terrain_resources.csv'),
    'tick,terrain,species,tiles,habitable,stock,capacity',
  );
  const activity = new Buffered(
    join(dir, 'activity.csv'),
    'tick,decider,action,folkTicks,energySpent,energyGained',
  );
  const sources = new Buffered(
    join(dir, 'food_sources.csv'),
    'tick,decider,species,terrain,attempts,successes,units,satiety',
  );
  const consumption = new Buffered(join(dir, 'consumption.csv'), 'tick,decider,good,units,satiety');
  const lifetimes = new Buffered(
    join(dir, 'lifetimes.csv'),
    [
      'id,decider,born,died,cause,lived',
      ...COUNTER_NAMES,
      ...Array.from({ length: MAX_PARAMS }, (_, i) => `p${i}`),
    ].join(','),
  );
  /** Who each Folk is, from its spawn event, for the lifetime table. */
  const born = new Map<number, { decider: string; tick: number; params: number[] }>();

  const writeEntities = (tick: number): void => {
    const f = sim.folk;
    const perGood = GOODS_LIST.length;
    for (let s = 0; s < f.count; s++) {
      const inv = GOODS_LIST.map((_, g) => f.inventory[s * perGood + g]!.toFixed(2)).join(',');
      entities.write(
        `${tick},${f.id[s]},${f.x[s]},${f.y[s]},${f.satiety[s]!.toFixed(2)},${f.health[s]!.toFixed(2)},${f.energy[s]!.toFixed(2)},${f.age[s]},${FOLK_ACTIONS[f.action[s]!]},${DECIDERS[f.decider[s]!]!.key},${f.injury[s]},${f.foraging[s]!.toFixed(3)},${f.hunting[s]!.toFixed(3)},${inv}\n`,
      );
    }
  };
  const writeResources = (tick: number): void => {
    const carried = carriedTotals(sim.folk);
    resources.write(
      `${[
        tick,
        ...speciesTotals(sim.ecology).map((t) => t.toFixed(1)),
        ...GOODS_LIST.map((g) => carried[g.key]!.toFixed(2)),
      ].join(',')}\n`,
    );
  };
  const num = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(3));
  const writeMetrics = (tick: number): void => {
    for (const r of terrainResources(sim.world, sim.ecology)) {
      terrainRes.write(
        `${tick},${r.terrain},${r.species},${r.tiles},${r.habitable},${r.stock.toFixed(1)},${r.capacity.toFixed(1)}\n`,
      );
    }
    for (const r of activityRows(sim.metrics)) {
      activity.write(
        `${tick},${r.decider},${r.action},${r.folkTicks},${num(r.energySpent)},${num(r.energyGained)}\n`,
      );
    }
    for (const r of sourceRows(sim.metrics)) {
      sources.write(
        `${tick},${r.decider},${r.species},${r.terrain},${r.attempts},${r.successes},${num(r.units)},${num(r.satiety)}\n`,
      );
    }
    for (const r of consumptionRows(sim.metrics)) {
      consumption.write(`${tick},${r.decider},${r.good},${num(r.units)},${num(r.satiety)}\n`);
    }
  };
  const writeLifetime = (
    id: number,
    counters: Record<string, number>,
    lived: number,
    died: string,
    cause: string,
  ): void => {
    const who = born.get(id);
    const params = Array.from({ length: MAX_PARAMS }, (_, i) => who?.params[i] ?? '');
    lifetimes.write(
      `${[id, who?.decider ?? '', who?.tick ?? '', died, cause, lived, ...COUNTER_NAMES.map((n) => counters[n] ?? 0), ...params].join(',')}\n`,
    );
  };
  const note = (e: SimEvent): void => {
    events.write(JSON.stringify(e) + '\n');
    if (e.type === 'spawn')
      born.set(e.folk, { decider: e.decider, tick: e.tick, params: e.params });
    else if (e.type === 'die') writeLifetime(e.folk, e.stats, e.lived, String(e.tick), e.cause);
  };

  let lastTick = -1;
  return {
    dir,
    runId: id,
    record(s) {
      const drained = s.drainEvents();
      for (const e of drained) note(e);
      if (s.tick % snapshotInterval === 0 && s.tick !== lastTick) {
        writeEntities(s.tick);
        writeResources(s.tick);
      }
      if (s.tick % metricsInterval === 0 && s.tick !== lastTick) writeMetrics(s.tick);
      lastTick = s.tick;
      return drained;
    },
    close(s) {
      for (const e of s.drainEvents()) note(e);
      // Always end with a final snapshot so analysis sees the last state.
      if (s.tick % snapshotInterval !== 0) {
        writeEntities(s.tick);
        writeResources(s.tick);
      }
      if (s.tick % metricsInterval !== 0) writeMetrics(s.tick);
      for (let slot = 0; slot < s.folk.count; slot++) {
        writeLifetime(s.folk.id[slot]!, folkCounters(s.metrics, slot), s.folk.age[slot]!, '', '');
      }
      const perf = s.perf;
      if (perf) {
        const timing = {
          ticks: s.tick,
          step: summarize(perf.step),
          ecology: summarize(perf.ecology),
          folk: summarize(perf.folk),
          scan: summarize(perf.scan),
          decide: Object.fromEntries(DECIDERS.map((d, i) => [d.key, summarize(perf.decide[i]!)])),
        };
        writeFileSync(join(dir, 'performance.json'), JSON.stringify(timing, null, 2));
      }
      events.close();
      entities.close();
      resources.close();
      terrainRes.close();
      activity.close();
      sources.close();
      consumption.close();
      lifetimes.close();
      writeFileSync(
        manifestPath,
        JSON.stringify({ ...manifest, ticks: s.tick, endedAt: new Date().toISOString() }, null, 2),
      );
    },
  };
}

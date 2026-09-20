import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  FOLK_ACTIONS,
  GOODS_LIST,
  SPECIES_LIST,
  speciesTotals,
  type Sim,
  type SimEvent,
} from '@folk/sim';

const FLUSH_BYTES = 64 * 1024;

export interface RunLoggerOptions {
  /** Directory that holds one folder per run (default: <repo>/experiments/output). */
  outputDir?: string;
  /** Write an entity and resource snapshot every N ticks (default 10). */
  snapshotInterval?: number;
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
    folkCount: sim.folk.count,
    emitMoves: sim.config.emitMoves ?? false,
    snapshotInterval,
    species: SPECIES_LIST.map((s) => s.key),
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
    'tick,id,x,y,satiety,health,energy,age,action,foraging,hunting' +
      GOODS_LIST.map((g) => `,inv_${g.key}`).join(''),
  );
  const resources = new Buffered(
    join(dir, 'resources.csv'),
    ['tick', ...SPECIES_LIST.map((s) => s.key)].join(','),
  );

  const writeEntities = (tick: number): void => {
    const f = sim.folk;
    const perGood = GOODS_LIST.length;
    for (let s = 0; s < f.count; s++) {
      const inv = GOODS_LIST.map((_, g) => f.inventory[s * perGood + g]!.toFixed(2)).join(',');
      entities.write(
        `${tick},${f.id[s]},${f.x[s]},${f.y[s]},${f.satiety[s]!.toFixed(2)},${f.health[s]!.toFixed(2)},${f.energy[s]!.toFixed(2)},${f.age[s]},${FOLK_ACTIONS[f.action[s]!]},${f.foraging[s]!.toFixed(3)},${f.hunting[s]!.toFixed(3)},${inv}\n`,
      );
    }
  };
  const writeResources = (tick: number): void => {
    resources.write(
      `${tick},${speciesTotals(sim.ecology)
        .map((t) => t.toFixed(1))
        .join(',')}\n`,
    );
  };

  let lastTick = -1;
  return {
    dir,
    runId: id,
    record(s) {
      const drained = s.drainEvents();
      for (const e of drained) events.write(JSON.stringify(e) + '\n');
      if (s.tick % snapshotInterval === 0 && s.tick !== lastTick) {
        writeEntities(s.tick);
        writeResources(s.tick);
      }
      lastTick = s.tick;
      return drained;
    },
    close(s) {
      const rest = s.drainEvents();
      for (const e of rest) events.write(JSON.stringify(e) + '\n');
      // Always end with a final snapshot so analysis sees the last state.
      if (s.tick % snapshotInterval !== 0) {
        writeEntities(s.tick);
        writeResources(s.tick);
      }
      events.close();
      entities.close();
      resources.close();
      writeFileSync(
        manifestPath,
        JSON.stringify({ ...manifest, ticks: s.tick, endedAt: new Date().toISOString() }, null, 2),
      );
    },
  };
}

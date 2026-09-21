import { defaultSettings, type Settings } from './config';
import { DECIDERS, deciderByKey } from './deciders';
import { createEcology, scaleRegrowth, stepEcology, type Ecology } from './ecology';
import type { SimEvent } from './events';
import { createFolkContext, stepFolk } from './folk/behaviour';
import { createFolkStore, initFolk, walkableTable, type FolkStore } from './folk/store';
import { createMetrics, type Metrics } from './metrics';
import { createPerf, type Perf } from './perf';
import { createRng, type Rng } from './rng';
import { generateWorld, type World, type WorldParams } from './world';

export interface SimConfig {
  seed: number;
  /** The run's configuration (default: the built-in defaults). Load one with `resolveSettings`. */
  settings?: Settings;
  /** The options below override the corresponding values in `settings`. */
  world?: Partial<WorldParams>;
  /** Run the ecology every N ticks; raise it for very large worlds. */
  ecologyInterval?: number;
  /** Number of Folk, held constant: a Folk that dies is replaced. */
  folkCount?: number;
  /** Plant regrowth (and animal appetite) relative to the default; below 1 makes food scarcer. */
  plantRegrowthScale?: number;
  /** Multiplies every species' patch coverage (more or less food). */
  coverageScale?: number;
  /** Animals graze their own forage instead of the berries and roots Folk gather. */
  separateAnimalFood?: boolean;
  /** Decider keys handed out to Folk in turn. */
  deciders?: string[];
  /** Folk appear alone at random places (true) or together at the settlement (false). */
  spawnRandom?: boolean;
  /** A Folk that dies is replaced (true) or stays dead (false). */
  replaceDead?: boolean;
  /** Also emit a `move` event for every step (verbose; off by default). */
  emitMoves?: boolean;
  /** Also emit a `goal` event whenever a Folk sets out for somewhere (off by default). */
  emitGoals?: boolean;
  /** Clock for timing (e.g. `performance.now`). The sim never reads a clock itself; without one, no timing is recorded. */
  timer?: () => number;
}

export interface Sim {
  readonly config: SimConfig;
  /** The settings this sim actually runs with: the configuration with the options above applied. */
  readonly settings: Settings;
  readonly rng: Rng;
  readonly world: World;
  readonly ecology: Ecology;
  readonly folk: FolkStore;
  /** Cumulative counters for tuning and analysis. */
  readonly metrics: Metrics;
  /** Timing statistics, or null when no timer was given. */
  readonly perf: Perf | null;
  /** Folk still alive (all of them, unless they are not replaced when they die). */
  aliveCount(): number;
  /** Number of completed ticks. */
  readonly tick: number;
  /** Return and clear the events produced since the last call. */
  drainEvents(): SimEvent[];
  /** Advance the simulation by one fixed timestep. */
  step(): void;
  /** The Folk looks around from where it stands, as it does after every step; returns the new places it remembers. */
  look(slot: number): number;
  /** Give a Folk knowledge of the ground within `radius` tiles of where it stands (its home ground at spawn). */
  learnArea(slot: number, radius?: number): void;
}

export function createSim(config: SimConfig): Sim {
  const base = config.settings ?? defaultSettings();
  const settings: Settings = {
    ...base,
    folk: {
      ...base.folk,
      count: config.folkCount ?? base.folk.count,
      deciders: config.deciders ?? base.folk.deciders,
      spawnRandom:
        config.spawnRandom === undefined ? base.folk.spawnRandom : config.spawnRandom ? 1 : 0,
      replaceDead:
        config.replaceDead === undefined ? base.folk.replaceDead : config.replaceDead ? 1 : 0,
    },
    ecology: {
      ...base.ecology,
      plantRegrowthScale: config.plantRegrowthScale ?? base.ecology.plantRegrowthScale,
      interval: Math.max(1, Math.floor(config.ecologyInterval ?? base.ecology.interval)),
      coverageScale: config.coverageScale ?? base.ecology.coverageScale,
      separateAnimalFood:
        config.separateAnimalFood === undefined
          ? base.ecology.separateAnimalFood
          : config.separateAnimalFood
            ? 1
            : 0,
    },
    world: { ...base.world, seed: config.seed, ...config.world },
  };

  const rng = createRng(config.seed);
  const world = generateWorld(settings.world);
  const ecology = createEcology(
    world,
    createRng(config.seed ^ 0x51ed270b),
    scaleRegrowth(settings.species, settings.ecology.plantRegrowthScale),
    {
      seed: settings.world.seed,
      coverageScale: settings.ecology.coverageScale,
      separateAnimalFood: settings.ecology.separateAnimalFood === 1,
      initialFill: settings.ecology.initialFill,
    },
  );
  const folk = createFolkStore(world, ecology, rng, settings.folk.count, settings);
  const events: SimEvent[] = [];
  const walkable = walkableTable();
  const mix = settings.folk.deciders.map((key) => DECIDERS.indexOf(deciderByKey(key)));
  for (let slot = 0; slot < folk.count; slot++) {
    const born = initFolk(folk, slot, world, rng, walkable, mix[slot % mix.length]!, settings);
    events.push({
      tick: 0,
      type: 'spawn',
      folk: born.id,
      x: born.x,
      y: born.y,
      reason: 'initial',
      decider: born.decider,
      params: born.params,
      reserve: born.reserve,
      terrain: born.terrain,
    });
  }
  const metrics = createMetrics(folk.count);
  const perf = config.timer ? createPerf(config.timer, DECIDERS.length) : null;
  const folkContext = createFolkContext(
    world,
    ecology,
    folk,
    metrics,
    perf,
    settings,
    rng,
    events,
    config.emitMoves ?? false,
    config.emitGoals ?? false,
  );
  for (let slot = 0; slot < folk.count; slot++) {
    folkContext.perception.learnArea(slot, 0, settings.perception.initialKnowledgeRadius);
  }
  const interval = settings.ecology.interval;
  let tick = 0;
  return {
    config,
    settings,
    rng,
    world,
    ecology,
    folk,
    metrics,
    perf,
    get tick() {
      return tick;
    },
    aliveCount() {
      let n = 0;
      for (let slot = 0; slot < folk.count; slot++) n += folk.alive[slot]!;
      return n;
    },
    look(slot) {
      return folkContext.perception.perceive(slot, tick);
    },
    learnArea(slot, radius = settings.perception.initialKnowledgeRadius) {
      folkContext.perception.learnArea(slot, tick, radius);
    },
    drainEvents() {
      return events.splice(0, events.length);
    },
    step() {
      tick += 1;
      if (!perf) {
        if (tick % interval === 0) stepEcology(world, ecology, interval);
        stepFolk(folkContext, tick);
        return;
      }
      const t0 = perf.timer();
      if (tick % interval === 0) stepEcology(world, ecology, interval);
      const t1 = perf.timer();
      stepFolk(folkContext, tick);
      const t2 = perf.timer();
      perf.ecology.record(t1 - t0);
      perf.folk.record(t2 - t1);
      perf.step.record(t2 - t0);
    },
  };
}

import { createRng, type Rng } from './rng';
import { FOLK } from './data/folk';
import type { SimEvent } from './events';
import { createFolkContext, stepFolk } from './folk/behaviour';
import { createFolkStore, initFolk, walkableTable, type FolkStore } from './folk/store';
import { createEcology, scaleRegrowth, stepEcology, type Ecology } from './ecology';
import { SPECIES_LIST } from './data/species';
import { DECIDERS, deciderByKey } from './deciders';
import { generateWorld, type World, type WorldParams } from './world';

export interface SimConfig {
  seed: number;
  /** World generation overrides; the world seed defaults to the sim seed. */
  world?: Partial<WorldParams>;
  /** Run the ecology every N ticks (default 1); raise it for very large worlds. */
  ecologyInterval?: number;
  /** Number of Folk, held constant: a Folk that dies is replaced (default 20). */
  folkCount?: number;
  /** Plant regrowth (and animal appetite) relative to the default; below 1 makes food scarcer. */
  plantRegrowthScale?: number;
  /** Multiplier on how fast Folk get hungry (1 = default). Higher makes food scarcer relative to need. */
  hungerScale?: number;
  /** Decider keys handed out to Folk in turn (default: every decider, evenly). */
  deciders?: string[];
  /** Also emit a `move` event for every step (verbose; off by default). */
  emitMoves?: boolean;
}

export interface Sim {
  readonly config: SimConfig;
  readonly rng: Rng;
  readonly world: World;
  readonly ecology: Ecology;
  readonly folk: FolkStore;
  /** Number of completed ticks. */
  readonly tick: number;
  /** Return and clear the events produced since the last call. */
  drainEvents(): SimEvent[];
  /** Advance the simulation by one fixed timestep. */
  step(): void;
}

export function createSim(config: SimConfig): Sim {
  const rng = createRng(config.seed);
  const world = generateWorld({ seed: config.seed, ...config.world });
  const ecology = createEcology(
    world,
    createRng(config.seed ^ 0x51ed270b),
    scaleRegrowth(SPECIES_LIST, config.plantRegrowthScale ?? 1),
  );
  const interval = Math.max(1, Math.floor(config.ecologyInterval ?? 1));
  const folk = createFolkStore(world, ecology, rng, config.folkCount ?? FOLK.count);
  const events: SimEvent[] = [];
  const walkable = walkableTable();
  const mix = (config.deciders ?? DECIDERS.map((d) => d.key)).map((key) =>
    DECIDERS.indexOf(deciderByKey(key)),
  );
  for (let slot = 0; slot < folk.count; slot++) {
    const born = initFolk(folk, slot, world, rng, walkable, mix[slot % mix.length]!);
    events.push({
      tick: 0,
      type: 'spawn',
      folk: born.id,
      x: born.x,
      y: born.y,
      reason: 'initial',
      decider: born.decider,
      params: born.params,
    });
  }
  const folkContext = createFolkContext(
    world,
    ecology,
    folk,
    rng,
    events,
    config.emitMoves ?? false,
    config.hungerScale ?? 1,
  );
  let tick = 0;
  return {
    config,
    rng,
    world,
    ecology,
    folk,
    get tick() {
      return tick;
    },
    drainEvents() {
      return events.splice(0, events.length);
    },
    step() {
      tick += 1;
      if (tick % interval === 0) stepEcology(world, ecology);
      stepFolk(folkContext, tick);
    },
  };
}

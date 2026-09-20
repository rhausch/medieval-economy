import { createRng, type Rng } from './rng';
import { createEcology, stepEcology, type Ecology } from './ecology';
import { generateWorld, type World, type WorldParams } from './world';

export interface SimConfig {
  seed: number;
  /** World generation overrides; the world seed defaults to the sim seed. */
  world?: Partial<WorldParams>;
  /** Run the ecology every N ticks (default 1); raise it for very large worlds. */
  ecologyInterval?: number;
}

export interface Sim {
  readonly config: SimConfig;
  readonly rng: Rng;
  readonly world: World;
  readonly ecology: Ecology;
  /** Number of completed ticks. */
  readonly tick: number;
  /** Advance the simulation by one fixed timestep. */
  step(): void;
}

export function createSim(config: SimConfig): Sim {
  const rng = createRng(config.seed);
  const world = generateWorld({ seed: config.seed, ...config.world });
  const ecology = createEcology(world, createRng(config.seed ^ 0x51ed270b));
  const interval = Math.max(1, Math.floor(config.ecologyInterval ?? 1));
  let tick = 0;
  return {
    config,
    rng,
    world,
    ecology,
    get tick() {
      return tick;
    },
    step() {
      tick += 1;
      if (tick % interval === 0) stepEcology(world, ecology);
    },
  };
}

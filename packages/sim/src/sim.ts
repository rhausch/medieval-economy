import { createRng, type Rng } from './rng';
import { generateWorld, type World, type WorldParams } from './world';

export interface SimConfig {
  seed: number;
  /** World generation overrides; the world seed defaults to the sim seed. */
  world?: Partial<WorldParams>;
}

export interface Sim {
  readonly config: SimConfig;
  readonly rng: Rng;
  readonly world: World;
  /** Number of completed ticks. */
  readonly tick: number;
  /** Advance the simulation by one fixed timestep. */
  step(): void;
}

export function createSim(config: SimConfig): Sim {
  const rng = createRng(config.seed);
  const world = generateWorld({ seed: config.seed, ...config.world });
  let tick = 0;
  return {
    config,
    rng,
    world,
    get tick() {
      return tick;
    },
    step() {
      tick += 1;
    },
  };
}

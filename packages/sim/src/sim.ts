import { createRng, type Rng } from './rng';

export interface SimConfig {
  seed: number;
}

export interface Sim {
  readonly config: SimConfig;
  readonly rng: Rng;
  /** Number of completed ticks. */
  readonly tick: number;
  /** Advance the simulation by one fixed timestep. */
  step(): void;
}

export function createSim(config: SimConfig): Sim {
  const rng = createRng(config.seed);
  let tick = 0;
  return {
    config,
    rng,
    get tick() {
      return tick;
    },
    step() {
      tick += 1;
    },
  };
}

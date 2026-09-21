import type { Settings } from '../config';

/** One tunable number in a decider's parameter array, with the range random starts are drawn from. */
export interface ParamSpec {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
}

/** What a Folk can sense when it decides. Filled in by the engine; read-only for deciders. */
export interface Senses {
  x: number;
  y: number;
  /** Calories in the reserve, the most it can hold, and its share of that. */
  reserve: number;
  capacity: number;
  /** 0 none, 1 minor, 2 serious. */
  injury: number;
  /** Calories the Folk would gain by eating everything it carries. */
  foodKcal: number;
  /** Carry capacity left, in kg. */
  roomKg: number;
  foraging: number;
  hunting: number;
  /** True if the Folk was resting when it last acted. */
  resting: boolean;
  /** Walking and action durations are multiplied by this while injured. */
  durationMultiplier: number;
  /** This Folk's decider parameters (read with `param`). */
  params: Float32Array;
  paramBase: number;
  /** Per option: tile of the nearest place the option can be done, or -1; and walking distance. */
  targetTile: Int32Array;
  targetDist: Int32Array;
  /** The run's configuration: action costs and yields, goods, body. */
  settings: Settings;
}

/** A decider's answer: what to do next and, for foraging, where. */
export interface Intent {
  option: number;
  tile: number;
}

export function param(s: Senses, index: number): number {
  return s.params[s.paramBase + index]!;
}

/**
 * A decision framework. Given the senses, the available options (with their cost and result
 * described by the action table) and the Folk's parameters, it picks the next option. It may write a
 * score per option into `scores` (NaN for unavailable options) so the inspector can explain it.
 */
export interface DeciderDef {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  /** Color of this decider's Folk on the map (0xRRGGBB). */
  readonly color: number;
  /** Default parameter ranges; a run's configuration may change the min and max. */
  readonly params: readonly ParamSpec[];
  decide(senses: Senses, out: Intent, scores: Float32Array): void;
}

/** Most parameters any decider may have. */
export const MAX_PARAMS = 8;

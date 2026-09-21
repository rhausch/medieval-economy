/** Decision options shared by every decider. Options 1-4 are foraging actions. */
export const OPTION = {
  eat: 0,
  gather: 1,
  dig: 2,
  snare: 3,
  chase: 4,
  rest: 5,
  wander: 6,
} as const;
export const OPTION_NAMES = ['eat', 'gather', 'dig', 'snare', 'chase', 'rest', 'wander'] as const;
export const OPTION_COUNT = OPTION_NAMES.length;

/** Internal states a Folk can be busy with besides the decision options. */
export const PENDING_NONE = 255;
export const PENDING_MOVE = 7;
export const PENDING_IDLE = 8;

/**
 * A foraging action: work a species at the Folk's current tile for `ticks`, then resolve.
 * Plants always yield `yield` kg (more with skill), taken from the tile's stock. Animals succeed
 * with a chance that grows with skill; a kill removes one head and yields `yield` kg of edible meat.
 * Numbers are defaults, adjustable per run in the configuration.
 */
export interface ForageDef {
  readonly option: number;
  readonly key: string;
  readonly name: string;
  /** Species key worked by this action. */
  readonly species: string;
  readonly kind: 'plant' | 'animal';
  /** Skill that improves the outcome and grows with use. */
  readonly skill: 'foraging' | 'hunting';
  /** Good produced (key in the goods table). */
  readonly good: string;
  readonly ticks: number;
  /** Calories burned per tick of this action, above the baseline metabolism. */
  readonly kcalPerTick: number;
  /** A tile is worth working when the species stock is at least this (kg for plants, head for animals). */
  readonly minStock: number;
  /** Plants: kg gathered at skill 0. Animals: kg of meat per kill. */
  readonly yield: number;
  /** Animals only: chance of a kill at skill 0. */
  readonly baseSuccess: number;
  /** Chance per attempt of a minor or a serious injury. */
  readonly minorInjury: number;
  readonly seriousInjury: number;
}

/**
 * Costs follow real activity levels: 1 MET is the baseline of about 7.9 kcal per 6-minute tick, so an
 * activity at 3 MET burns about 16 kcal per tick above baseline.
 */
export const FORAGE_ACTIONS: readonly ForageDef[] = [
  {
    option: OPTION.gather,
    key: 'gather',
    name: 'Gather berries',
    species: 'berries',
    kind: 'plant',
    skill: 'foraging',
    good: 'berries',
    ticks: 4,
    kcalPerTick: 16,
    minStock: 5,
    yield: 0.6,
    baseSuccess: 1,
    minorInjury: 0,
    seriousInjury: 0,
  },
  {
    option: OPTION.dig,
    key: 'dig',
    name: 'Dig roots and nuts',
    species: 'roots',
    kind: 'plant',
    skill: 'foraging',
    good: 'roots',
    ticks: 12,
    kcalPerTick: 36,
    minStock: 10,
    yield: 1.6,
    baseSuccess: 1,
    minorInjury: 0.03,
    seriousInjury: 0,
  },
  {
    option: OPTION.snare,
    key: 'snare',
    name: 'Snare hare',
    species: 'hare',
    kind: 'animal',
    skill: 'hunting',
    good: 'meat',
    ticks: 5,
    kcalPerTick: 16,
    minStock: 1,
    yield: 1.5,
    baseSuccess: 0.5,
    minorInjury: 0,
    seriousInjury: 0,
  },
  {
    option: OPTION.chase,
    key: 'chase',
    name: 'Chase deer',
    species: 'deer',
    kind: 'animal',
    skill: 'hunting',
    good: 'meat',
    ticks: 20,
    kcalPerTick: 87,
    minStock: 1,
    yield: 45,
    baseSuccess: 0.5,
    minorInjury: 0.15,
    seriousInjury: 0.05,
  },
];

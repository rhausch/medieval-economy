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
 * Plants always yield (take stock, gain `good`); animals succeed with a chance that grows
 * with skill (take one head, gain `yield` of `good`). Numbers are placeholders to tune by playing.
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
  readonly energy: number;
  /** A tile is worth working when the species stock is at least this. */
  readonly minStock: number;
  /** Plants: units gathered at skill 0. Animals: units of good per kill. */
  readonly yield: number;
  /** Animals only: chance of a kill at skill 0. */
  readonly baseSuccess: number;
  /** Chance per attempt of a minor or a serious injury. */
  readonly minorInjury: number;
  readonly seriousInjury: number;
}

export const FORAGE_ACTIONS: readonly ForageDef[] = [
  {
    option: OPTION.gather,
    key: 'gather',
    name: 'Gather berries',
    species: 'berries',
    kind: 'plant',
    skill: 'foraging',
    good: 'plantFood',
    ticks: 4,
    energy: 0.5,
    minStock: 5,
    yield: 3,
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
    good: 'plantFood',
    ticks: 12,
    energy: 3,
    minStock: 10,
    yield: 14,
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
    energy: 0.5,
    minStock: 1,
    yield: 3,
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
    energy: 6,
    minStock: 1,
    yield: 20,
    baseSuccess: 0.5,
    minorInjury: 0.15,
    seriousInjury: 0.05,
  },
];

export function forageDef(option: number): ForageDef | undefined {
  return FORAGE_ACTIONS.find((a) => a.option === option);
}

/** Skill gained per attempt, as a fraction of the distance to the maximum of 1. */
export const SKILL_GAIN = 0.004;
/** How much each point of skill adds to a plant yield multiplier or an animal success chance. */
export const SKILL_YIELD_BONUS = 1;
export const SKILL_SUCCESS_BONUS = 0.4;
export const MAX_SUCCESS = 0.95;

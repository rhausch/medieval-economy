/** Folk tuning. Rates are per tick. */
export const FOLK = {
  count: 20,
  maxStat: 100,
  /** Satiety lost per tick. */
  satietyDecay: 0.12,
  /** Health lost per tick while satiety is 0. */
  starvationDamage: 0.5,
  /** Health regained per tick while satiety is above `regenSatiety`. */
  regen: 0.05,
  regenSatiety: 50,
  /** Energy spent per tile walked. */
  moveEnergyCost: 0.3,
  /** Resting takes `restTicks` ticks and restores this much energy. */
  restTicks: 3,
  restEnergyGain: 3,
  idleEnergyGain: 0.1,
  /** Chance a wandering Folk stands still for a moment instead of stepping. */
  idleChance: 0.4,
  /** Most edible goods (in units) eaten in one eating action. */
  eatBite: 10,
  /** Carry limit in weight units. */
  carryCapacity: 20,
  /** Furthest walking distance searched for work. */
  searchDepth: 60,
  startSatiety: { min: 60, max: 100 },
  /** Settlement site: candidates sampled, radius for scoring food, and distance to water. */
  settlementCandidates: 60,
  settlementScoreRadius: 6,
  settlementWaterDistance: 4,
  /** Radius around the settlement where Folk appear. */
  spawnRadius: 5,
} as const;

/**
 * Injury levels: 0 none, 1 minor, 2 serious. Injured Folk move and work slower (durations are
 * multiplied), lose health when hurt, and heal one level after `healTicks` at that level.
 */
export const INJURY = {
  durationMultiplier: [1, 2, 10],
  damage: [0, 5, 25],
  healTicks: [0, 300, 400],
  names: ['none', 'minor', 'serious'],
} as const;

export const FOLK_ACTIONS = [
  'idle',
  'moving',
  'eating',
  'resting',
  'gathering',
  'digging',
  'snaring',
  'chasing',
] as const;
export type FolkAction = (typeof FOLK_ACTIONS)[number];

/** Folk tuning. Rates are per tick. */
export const FOLK = {
  count: 20,
  maxStat: 100,
  /** Satiety lost per tick. */
  satietyDecay: 0.12,
  /** Below this satiety a Folk looks for food. */
  hungerThreshold: 45,
  /** Most food units taken in one eating action. */
  bite: 10,
  /** A tile is worth eating from when it holds at least this much plant food. */
  minFoodTile: 8,
  /** Health lost per tick while satiety is 0. */
  starvationDamage: 0.5,
  /** Health regained per tick while satiety is above `regenSatiety`. */
  regen: 0.05,
  regenSatiety: 50,
  moveEnergyCost: 0.3,
  restEnergyGain: 1,
  idleEnergyGain: 0.1,
  tiredThreshold: 20,
  restUntil: 60,
  /** Chance a wandering Folk stands still for a tick instead of stepping. */
  idleChance: 0.4,
  /** Furthest walking distance searched for food. */
  searchDepth: 60,
  carryCapacity: 20,
  startSatiety: { min: 60, max: 100 },
  /** Settlement site: candidates sampled, radius for scoring food, and distance to water. */
  settlementCandidates: 60,
  settlementScoreRadius: 6,
  settlementWaterDistance: 4,
  /** Radius around the settlement where Folk appear. */
  spawnRadius: 5,
} as const;

export const FOLK_ACTIONS = ['idle', 'moving', 'eating', 'resting'] as const;
export type FolkAction = (typeof FOLK_ACTIONS)[number];

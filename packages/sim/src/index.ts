export { createRng, type Rng } from './rng';
export { createSim, type Sim, type SimConfig } from './sim';
export { generateWorld, DEFAULT_WORLD_PARAMS, type World, type WorldParams } from './world';
export {
  TERRAIN,
  TERRAIN_LIST,
  terrainById,
  type TerrainDef,
  type TerrainCategory,
} from './data/terrain';
export { createEcology, scaleRegrowth, stepEcology, speciesTotals, type Ecology } from './ecology';
export { SPECIES_LIST, type SpeciesDef, type PlantDef, type AnimalDef } from './data/species';
export { GOODS_LIST, type GoodDef } from './data/goods';
export { FOLK, FOLK_ACTIONS, type FolkAction } from './data/folk';
export type { FolkStore } from './folk/store';
export type { SimEvent } from './events';
export { DECIDERS, deciderByKey, MAX_PARAMS, type DeciderDef, type ParamSpec } from './deciders';
export { FORAGE_ACTIONS, OPTION, OPTION_NAMES, OPTION_COUNT, type ForageDef } from './data/actions';
export { INJURY } from './data/folk';
export {
  COUNTER_NAMES,
  COUNTER_COUNT,
  SOURCE_FIELDS,
  activityRows,
  carriedTotals,
  consumptionRows,
  folkCounters,
  sourceRows,
  terrainResources,
  type ActivityRow,
  type ConsumptionRow,
  type Metrics,
  type SourceRow,
  type TerrainResourceRow,
} from './metrics';
export { TimingStat, resetPerf, summarize, type Perf, type TimingSummary } from './perf';

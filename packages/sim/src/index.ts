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
export { createEcology, stepEcology, speciesTotals, type Ecology } from './ecology';
export { SPECIES_LIST, type SpeciesDef, type PlantDef, type AnimalDef } from './data/species';

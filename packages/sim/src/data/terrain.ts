/**
 * Terrain table. Ids index typed arrays, so they are stable and dense.
 * `category` groups terrains for rules that do not care about the subtype
 * (e.g. water later splits into lake, river and ocean).
 */
export type TerrainCategory = 'water' | 'shore' | 'lowland' | 'highland' | 'mountain';

export interface TerrainDef {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly category: TerrainCategory;
  readonly walkable: boolean;
  /** Base color as 0xRRGGBB, shaded by elevation when rendered. */
  readonly color: number;
}

export const TERRAIN = {
  water: {
    id: 0,
    key: 'water',
    name: 'Water',
    category: 'water',
    walkable: false,
    color: 0x2f6fb0,
  },
  sand: { id: 1, key: 'sand', name: 'Sand', category: 'shore', walkable: true, color: 0xe6d99b },
  grass: {
    id: 2,
    key: 'grass',
    name: 'Grassland',
    category: 'lowland',
    walkable: true,
    color: 0x6fae4f,
  },
  forest: {
    id: 3,
    key: 'forest',
    name: 'Forest',
    category: 'lowland',
    walkable: true,
    color: 0x2f7a3a,
  },
  hills: {
    id: 4,
    key: 'hills',
    name: 'Hills',
    category: 'highland',
    walkable: true,
    color: 0x93694a,
  },
  mountain: {
    id: 5,
    key: 'mountain',
    name: 'Mountain',
    category: 'mountain',
    walkable: false,
    color: 0x8a8a92,
  },
} as const satisfies Record<string, TerrainDef>;

export const TERRAIN_LIST: readonly TerrainDef[] = Object.values(TERRAIN).sort(
  (a, b) => a.id - b.id,
);

export function terrainById(id: number): TerrainDef {
  const def = TERRAIN_LIST[id];
  if (!def) throw new Error(`unknown terrain id ${id}`);
  return def;
}

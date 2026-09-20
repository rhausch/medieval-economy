import { TERRAIN } from '../data/terrain';
import { createPerlin, fbmField } from './noise';

export interface WorldParams {
  seed: number;
  width: number;
  height: number;
  /** Feature size in tiles; larger gives bigger continents and biomes. */
  noiseScale: number;
  octaves: number;
  /** Fraction of all tiles that are water. */
  waterFraction: number;
  /** Fraction of all tiles that are sandy shore, just above the water line. */
  beachFraction: number;
  /** Fraction of land (above shore) that is hills. */
  hillFraction: number;
  /** Fraction of land (above shore) that is mountain. */
  mountainFraction: number;
  /** Fraction of lowland that is forest (wettest lowland tiles). */
  forestFraction: number;
}

export const DEFAULT_WORLD_PARAMS: WorldParams = {
  seed: 1,
  width: 256,
  height: 256,
  noiseScale: 200,
  octaves: 6,
  waterFraction: 0.3,
  beachFraction: 0.03,
  hillFraction: 0.2,
  mountainFraction: 0.06,
  forestFraction: 0.4,
};

export interface World {
  readonly params: WorldParams;
  readonly width: number;
  readonly height: number;
  /** Terrain id per tile, row-major. */
  readonly terrain: Uint8Array;
  /** Elevation in [0, 1] per tile. */
  readonly elevation: Float32Array;
  /** Moisture in [0, 1] per tile. */
  readonly moisture: Float32Array;
}

/** Value at the given quantile (0..1) of the values, without mutating the input. */
function quantile(values: Float32Array, q: number): number {
  if (values.length === 0) return 0;
  const sorted = Float32Array.from(values).sort();
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[i]!;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function generateWorld(overrides: Partial<WorldParams> = {}): World {
  const params: WorldParams = { ...DEFAULT_WORLD_PARAMS, ...overrides };
  const { width, height } = params;
  const n = width * height;
  const opts = { scale: params.noiseScale, octaves: params.octaves };

  const elevation = fbmField(createPerlin(params.seed), width, height, opts);
  const moisture = fbmField(createPerlin(params.seed ^ 0x9e3779b9), width, height, opts);

  const water = clamp01(params.waterFraction);
  const shore = clamp01(water + params.beachFraction);
  const waterLevel = quantile(elevation, water);
  const shoreLevel = quantile(elevation, shore);

  // Land above the shore, used for relative hill and mountain thresholds.
  const inland: number[] = [];
  for (let i = 0; i < n; i++) if (elevation[i]! > shoreLevel) inland.push(elevation[i]!);
  const inlandEl = Float32Array.from(inland);
  const mountainLevel = quantile(inlandEl, 1 - clamp01(params.mountainFraction));
  const hillLevel = quantile(inlandEl, 1 - clamp01(params.mountainFraction + params.hillFraction));

  // Wettest lowland becomes forest.
  const lowMoist: number[] = [];
  for (let i = 0; i < n; i++) {
    const e = elevation[i]!;
    if (e > shoreLevel && e <= hillLevel) lowMoist.push(moisture[i]!);
  }
  const forestLevel = quantile(Float32Array.from(lowMoist), 1 - clamp01(params.forestFraction));

  const terrain = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const e = elevation[i]!;
    let t: number;
    if (e <= waterLevel) t = TERRAIN.water.id;
    else if (e <= shoreLevel) t = TERRAIN.sand.id;
    else if (e > mountainLevel) t = TERRAIN.mountain.id;
    else if (e > hillLevel) t = TERRAIN.hills.id;
    else t = moisture[i]! >= forestLevel ? TERRAIN.forest.id : TERRAIN.grass.id;
    terrain[i] = t;
  }

  return { params, width, height, terrain, elevation, moisture };
}

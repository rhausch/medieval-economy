import type { SpeciesDef } from '../data/species';
import { createPerlin, fbmField, type World } from '../world';

/** Value at quantile q (0..1) of the values, without mutating the input. */
function quantile(values: Float32Array, q: number): number {
  const sorted = Float32Array.from(values).sort();
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[i]!;
}

/**
 * Where a species lives: a richness factor per tile, 0 outside its patches and between `1 - patchRichness`
 * (a patch's edge) and 1 (its core) inside. Each species has its own noise field, cut at the level that
 * makes its patches cover `coverage` of the tiles it could live on at all. `habitable` says which tiles
 * those are. Deterministic in the world seed.
 */
export function patchFactors(
  world: World,
  def: SpeciesDef,
  habitable: Float32Array,
  seed: number,
  coverageScale: number,
): Float32Array {
  const n = world.terrain.length;
  const factor = new Float32Array(n);
  const coverage = Math.min(1, def.coverage * coverageScale);
  if (coverage >= 1) {
    for (let i = 0; i < n; i++) if (habitable[i]! > 0) factor[i] = 1;
    return factor;
  }
  const field = fbmField(
    createPerlin((seed ^ (0x9e3779b9 + def.id * 7919)) >>> 0),
    world.width,
    world.height,
    {
      scale: def.patchScale,
      octaves: 2,
    },
  );
  const inside: number[] = [];
  for (let i = 0; i < n; i++) if (habitable[i]! > 0) inside.push(field[i]!);
  if (inside.length === 0) return factor;
  const threshold = quantile(Float32Array.from(inside), 1 - coverage);
  const richness = def.patchRichness;
  for (let i = 0; i < n; i++) {
    if (habitable[i]! <= 0 || field[i]! < threshold) continue;
    const core = threshold >= 1 ? 1 : (field[i]! - threshold) / (1 - threshold);
    factor[i] = 1 - richness + richness * core;
  }
  return factor;
}

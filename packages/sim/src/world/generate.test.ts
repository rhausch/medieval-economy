import { describe, expect, it } from 'vitest';
import { TERRAIN, TERRAIN_LIST } from '../data/terrain';
import { generateWorld } from './generate';

const small = { width: 96, height: 80, noiseScale: 24 };

function fraction(w: ReturnType<typeof generateWorld>, id: number): number {
  let count = 0;
  for (const t of w.terrain) if (t === id) count++;
  return count / w.terrain.length;
}

describe('generateWorld', () => {
  it('is deterministic for the same params', () => {
    const a = generateWorld({ seed: 5, ...small });
    const b = generateWorld({ seed: 5, ...small });
    expect(a.terrain).toEqual(b.terrain);
    expect(a.elevation).toEqual(b.elevation);
  });

  it('differs between seeds', () => {
    const a = generateWorld({ seed: 5, ...small });
    const b = generateWorld({ seed: 6, ...small });
    expect(a.terrain).not.toEqual(b.terrain);
  });

  it('has the requested dimensions and only valid terrain ids', () => {
    const w = generateWorld({ seed: 2, ...small });
    expect(w.terrain.length).toBe(small.width * small.height);
    for (const t of w.terrain) expect(t).toBeLessThan(TERRAIN_LIST.length);
  });

  it('honours the water fraction', () => {
    const w = generateWorld({ seed: 3, ...small, waterFraction: 0.4 });
    expect(fraction(w, TERRAIN.water.id)).toBeCloseTo(0.4, 1);
  });

  it('produces every terrain type on a default-ish world', () => {
    const w = generateWorld({ seed: 9, ...small });
    for (const def of TERRAIN_LIST) expect(fraction(w, def.id)).toBeGreaterThan(0);
  });

  it('forms coherent regions rather than random tiling', () => {
    const w = generateWorld({ seed: 4, ...small });
    let same = 0;
    let total = 0;
    for (let y = 0; y < w.height; y++) {
      for (let x = 0; x < w.width - 1; x++) {
        total++;
        if (w.terrain[y * w.width + x] === w.terrain[y * w.width + x + 1]) same++;
      }
    }
    expect(same / total).toBeGreaterThan(0.8);
  });
});

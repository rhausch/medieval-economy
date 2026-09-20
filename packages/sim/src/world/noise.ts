import { createRng } from '../rng';

const GRADS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

export type Noise2D = (x: number, y: number) => number;

/** Seeded 2D Perlin (gradient) noise, roughly in [-1, 1]. Uses only basic arithmetic. */
export function createPerlin(seed: number): Noise2D {
  const rng = createRng(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = p[i]!;
    p[i] = p[j]!;
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;

  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (hash: number, x: number, y: number): number => {
    const g = GRADS[hash & 7]!;
    return g[0] * x + g[1] * y;
  };

  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[X]! + Y]!;
    const ab = perm[perm[X]! + Y + 1]!;
    const ba = perm[perm[X + 1]! + Y]!;
    const bb = perm[perm[X + 1]! + Y + 1]!;
    const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
    const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
    return x1 + v * (x2 - x1);
  };
}

export interface FbmOptions {
  /** Feature size in tiles: larger means smoother, bigger regions. */
  scale: number;
  octaves: number;
}

/** Fill a width*height field with fractal noise, normalized to [0, 1] by min/max. */
export function fbmField(
  noise: Noise2D,
  width: number,
  height: number,
  opts: FbmOptions,
): Float32Array {
  const field = new Float32Array(width * height);
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let amp = 1;
      let freq = 1 / opts.scale;
      let sum = 0;
      for (let o = 0; o < opts.octaves; o++) {
        sum += amp * noise(x * freq, y * freq);
        amp *= 0.5;
        freq *= 2;
      }
      field[y * width + x] = sum;
      if (sum < min) min = sum;
      if (sum > max) max = sum;
    }
  }
  const range = max - min || 1;
  for (let i = 0; i < field.length; i++) field[i] = (field[i]! - min) / range;
  return field;
}

import type { Senses } from './types';

/**
 * Among the remembered places a foraging option can use, the index of the one that is quickest to reach and still
 * worth going to (at least `minAmount` there when last seen, and seen within `maxAge` ticks); -1 if there is none.
 */
export function nearestPlace(s: Senses, option: number, minAmount: number, maxAge: number): number {
  let best = -1;
  for (let i = 0; i < s.memCount; i++) {
    if (s.memOption[i] !== option || s.memAmount[i]! < minAmount || s.memAge[i]! > maxAge) continue;
    if (best < 0 || s.memTicks[i]! < s.memTicks[best]!) best = i;
  }
  return best;
}

import {
  FORAGE_ACTIONS,
  MAX_SUCCESS,
  OPTION,
  OPTION_COUNT,
  SKILL_SUCCESS_BONUS,
  SKILL_YIELD_BONUS,
} from '../data/actions';
import { GOODS_LIST } from '../data/goods';
import { param, type DeciderDef, type Intent, type Senses } from './types';

const P = { need: 0, yield: 1, effort: 2, risk: 3, distance: 4, rest: 5, wander: 6, reserve: 7 };

const goodValue = (key: string): number => GOODS_LIST.find((g) => g.key === key)?.foodValue ?? 1;

/**
 * Utility AI: score every available option on how hungry the Folk is, the expected satiety per tick
 * (including the walk), and the effort, injury risk and distance it costs, each scaled by that Folk's
 * own weights. The highest score wins.
 */
export const UTILITY: DeciderDef = {
  id: 1,
  key: 'utility',
  name: 'Utility',
  color: 0x4fd1c5,
  params: [
    { key: 'wNeed', label: 'Weight: hunger', min: 0.2, max: 2 },
    { key: 'wYield', label: 'Weight: yield', min: 0.2, max: 2 },
    { key: 'wEffort', label: 'Weight: effort', min: 0, max: 2 },
    { key: 'wRisk', label: 'Weight: risk', min: 0, max: 2 },
    { key: 'wDistance', label: 'Weight: distance', min: 0, max: 2 },
    { key: 'wRest', label: 'Weight: rest', min: 0.2, max: 2 },
    { key: 'wWander', label: 'Weight: wander', min: 0, max: 0.5 },
    { key: 'reserve', label: 'Food reserve wanted', min: 5, max: 25 },
  ],
  decide(s: Senses, out: Intent, scores: Float32Array): void {
    scores.fill(Number.NaN, 0, OPTION_COUNT);
    const hunger = 1 - s.satiety / 100;
    const reserveFill = Math.min(1, s.foodSatiety / param(s, P.reserve));
    // How much more food is worth having: hunger, plus how far the carried reserve is below the wanted one.
    const motive = 0.05 + hunger + (1 - reserveFill);

    if (s.foodSatiety > 0 && s.satiety < 95) {
      scores[OPTION.eat] = param(s, P.need) * 2.5 * (hunger - 0.25);
    }

    for (const def of FORAGE_ACTIONS) {
      const tile = s.targetTile[def.option]!;
      if (tile < 0 || s.room < 1) continue;
      const dist = s.targetDist[def.option]!;
      const m = s.durationMultiplier;
      const skill = def.skill === 'foraging' ? s.foraging : s.hunting;
      const value = goodValue(def.good);
      const expected =
        def.kind === 'plant'
          ? Math.min(def.yield * (1 + SKILL_YIELD_BONUS * skill), s.room) * value
          : Math.min(MAX_SUCCESS, def.baseSuccess + SKILL_SUCCESS_BONUS * skill) *
            Math.min(def.yield, s.room) *
            value;
      const rate = expected / (dist * m + Math.ceil(def.ticks * m));
      const effort = def.energy + 0.3 * dist;
      const risk = (def.minorInjury + 4 * def.seriousInjury) * (1 + (100 - s.health) / 100);
      scores[def.option] =
        param(s, P.yield) * rate * motive -
        (param(s, P.effort) * effort) / 10 -
        param(s, P.risk) * risk * 2 -
        (param(s, P.distance) * dist) / 40;
    }

    scores[OPTION.rest] = param(s, P.rest) * 3 * Math.max(0, 0.6 - s.energy / 100);
    scores[OPTION.wander] = param(s, P.wander);

    let best = OPTION.wander as number;
    let bestScore = -Infinity;
    for (let option = 0; option < OPTION_COUNT; option++) {
      const score = scores[option]!;
      if (score > bestScore) {
        bestScore = score;
        best = option;
      }
    }
    out.option = best;
    out.tile = s.targetTile[best] ?? -1;
  },
};

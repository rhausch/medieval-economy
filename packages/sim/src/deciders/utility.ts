import { OPTION, OPTION_COUNT } from '../data/actions';
import { param, type DeciderDef, type Intent, type Senses } from './types';

/** Below this share of the reserve (hunger above 0.6) eating beats everything else in the scoring. */
const EMERGENCY_HUNGER = 0.6;

/** The score eating gets in an emergency, above anything else an option can reach. */
const EMERGENCY_SCORE = 100;

const P = { need: 0, yield: 1, effort: 2, risk: 3, distance: 4, rest: 5, wander: 6, reserve: 7 };

/**
 * Utility AI: score every available option on how hungry the Folk is, the expected net calories per
 * tick (what the food is worth minus what the walk and the work burn, over the time both take), and the
 * effort, injury risk and distance, each scaled by that Folk's own weights. The highest score wins.
 */
export const UTILITY: DeciderDef = {
  id: 1,
  key: 'utility',
  name: 'Utility',
  color: 0x4fd1c5,
  params: [
    { key: 'wNeed', label: 'Weight: hunger', min: 0.2, max: 2 },
    { key: 'wYield', label: 'Weight: net calories', min: 0.2, max: 2 },
    { key: 'wEffort', label: 'Weight: effort', min: 0, max: 2 },
    { key: 'wRisk', label: 'Weight: risk', min: 0, max: 2 },
    { key: 'wDistance', label: 'Weight: distance', min: 0, max: 2 },
    { key: 'wRest', label: 'Weight: rest', min: 0.2, max: 2 },
    { key: 'wWander', label: 'Weight: wander', min: 0, max: 0.5 },
    { key: 'reserve', label: 'Food carried wanted (kcal)', min: 1500, max: 12000 },
  ],
  decide(s: Senses, out: Intent, scores: Float32Array): void {
    scores.fill(Number.NaN, 0, OPTION_COUNT);
    const { goods, skills } = s.settings;
    const kcalPerKg = (key: string): number => goods.find((g) => g.key === key)?.kcalPerKg ?? 0;
    const hunger = 1 - s.reserve / s.capacity;
    const carriedFill = Math.min(1, s.foodKcal / param(s, P.reserve));
    // How much more food is worth having. It falls to almost nothing once the Folk carries as much as it
    // wants; below that, it grows with how much is missing and how hungry the Folk is.
    const motive = 0.02 + (1 - carriedFill) * (0.5 + hunger);
    // A survival instinct that no personality can switch off: hungry and short of food, any foraging that
    // pays for itself gets a bonus, so a starving Folk always goes and finds something to eat.
    const survival = 4 * Math.max(0, hunger - 0.3) * (1 - carriedFill);

    if (s.foodKcal > 0 && s.reserve < 0.95 * s.capacity) {
      scores[OPTION.eat] = param(s, P.need) * 2.5 * (hunger - 0.25);
      // In an emergency eating outranks everything, whatever the Folk's personality: nobody starves with
      // food in their pocket. `shouldInterrupt` uses the same threshold, so an interrupt always leads to a meal.
      if (hunger > EMERGENCY_HUNGER) scores[OPTION.eat] = EMERGENCY_SCORE;
    }

    for (const def of s.settings.actions) {
      const tile = s.targetTile[def.option]!;
      if (tile < 0 || s.roomKg < 0.5) continue;
      const walkTicks = s.targetTicks[def.option]!;
      const m = s.durationMultiplier;
      const skill = def.skill === 'foraging' ? s.foraging : s.hunting;
      const kg =
        def.kind === 'plant'
          ? Math.min(def.yield * (1 + skills.yieldBonus * skill), s.roomKg)
          : Math.min(skills.maxSuccess, def.baseSuccess + skills.successBonus * skill) *
            Math.min(def.yield, s.roomKg);
      const gain = kg * kcalPerKg(def.good);
      const travelTicks = walkTicks * m;
      const workTicks = Math.ceil(def.ticks * m);
      // Calories burned above baseline by the walk (including climbing) and the work.
      const cost = s.targetKcal[def.option]! * m + workTicks * def.kcalPerTick;
      const rate = (gain - cost) / (travelTicks + workTicks);
      const risk = (def.minorInjury + 4 * def.seriousInjury) * (1 + hunger);
      scores[def.option] =
        (rate > 0 ? survival : 0) +
        param(s, P.yield) * (rate / (100 + Math.abs(rate))) * motive -
        (param(s, P.effort) * cost) / 1000 -
        param(s, P.risk) * risk * 2 -
        (param(s, P.distance) * walkTicks) / 40;
    }

    scores[OPTION.rest] = s.injury > 0 ? param(s, P.rest) * 0.5 * s.injury * (1 - hunger) : 0;
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
  /** In the emergency zone with food in the pack: stop and eat. */
  shouldInterrupt(s: Senses): boolean {
    return s.foodKcal > 0 && 1 - s.reserve / s.capacity > EMERGENCY_HUNGER;
  },
};

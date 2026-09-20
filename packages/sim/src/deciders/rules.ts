import { FORAGE_ACTIONS, OPTION, OPTION_COUNT } from '../data/actions';
import { param, type DeciderDef, type Intent, type Senses } from './types';

const P = { hungerThreshold: 0, tiredThreshold: 1, restUntil: 2, foodTarget: 3, riskTolerance: 4 };

/** Try safe work first, or the risky high-yield work first when the Folk is bold and healthy. */
const SAFE_FIRST = [OPTION.gather, OPTION.snare, OPTION.dig, OPTION.chase];
const BOLD_FIRST = [OPTION.dig, OPTION.chase, OPTION.gather, OPTION.snare];

function available(s: Senses, option: number): boolean {
  if (s.targetTile[option]! < 0 || s.room < 1) return false;
  const def = FORAGE_ACTIONS.find((a) => a.option === option);
  return !!def && !(def.seriousInjury > 0 && s.health < 60);
}

/** Rule-based baseline: eat when hungry, rest when tired, restock food, otherwise wander. */
export const RULES: DeciderDef = {
  id: 0,
  key: 'rules',
  name: 'Rules',
  color: 0xffd23f,
  params: [
    { key: 'hungerThreshold', label: 'Eats below satiety', min: 25, max: 70 },
    { key: 'tiredThreshold', label: 'Rests below energy', min: 10, max: 40 },
    { key: 'restUntil', label: 'Rests until energy', min: 50, max: 90 },
    { key: 'foodTarget', label: 'Carries food worth', min: 6, max: 24 },
    { key: 'riskTolerance', label: 'Risk tolerance', min: 0, max: 1 },
  ],
  decide(s: Senses, out: Intent, scores: Float32Array): void {
    scores.fill(Number.NaN, 0, OPTION_COUNT);
    const choose = (option: number): void => {
      out.option = option;
      out.tile = s.targetTile[option] ?? -1;
      scores[option] = 1;
    };
    if (s.satiety < param(s, P.hungerThreshold) && s.foodSatiety > 0) return choose(OPTION.eat);
    if (s.energy < param(s, P.tiredThreshold) || (s.resting && s.energy < param(s, P.restUntil))) {
      return choose(OPTION.rest);
    }
    if (s.foodSatiety < param(s, P.foodTarget)) {
      const bold = param(s, P.riskTolerance) > 0.5 && s.energy > 50 && s.health > 60;
      for (const option of bold ? BOLD_FIRST : SAFE_FIRST) {
        if (available(s, option)) return choose(option);
      }
    }
    choose(OPTION.wander);
  },
};

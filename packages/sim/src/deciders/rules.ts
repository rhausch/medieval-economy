import { OPTION, OPTION_COUNT } from '../data/actions';
import { param, type DeciderDef, type Intent, type Senses } from './types';

const P = { eatBelow: 0, foodTarget: 1, riskTolerance: 2, restIfInjured: 3 };

/** Try safe work first, or the risky high-yield work first when the Folk is bold and well fed. */
const SAFE_FIRST = [OPTION.gather, OPTION.snare, OPTION.dig, OPTION.chase];
const BOLD_FIRST = [OPTION.dig, OPTION.chase, OPTION.gather, OPTION.snare];

function available(s: Senses, option: number): boolean {
  if (s.targetTile[option]! < 0 || s.roomKg < 0.5) return false;
  const def = s.settings.actions.find((a) => a.option === option);
  // Nobody starving goes after something that can seriously hurt them.
  return !!def && !(def.seriousInjury > 0 && s.reserve < 0.4 * s.capacity);
}

/**
 * Rule-based baseline: eat when the reserve runs low, rest when hurt, restock food, otherwise wander.
 * Parameters: reserve level to eat at (share of capacity), how much food to carry (kcal), risk
 * tolerance, and the injury level above which it rests.
 */
export const RULES: DeciderDef = {
  id: 0,
  key: 'rules',
  name: 'Rules',
  color: 0xffd23f,
  params: [
    { key: 'eatBelow', label: 'Eats below reserve', min: 0.15, max: 0.7 },
    { key: 'foodTarget', label: 'Carries food (kcal)', min: 1500, max: 12000 },
    { key: 'riskTolerance', label: 'Risk tolerance', min: 0, max: 1 },
    { key: 'restIfInjured', label: 'Rests if injury above', min: 0, max: 2 },
  ],
  decide(s: Senses, out: Intent, scores: Float32Array): void {
    scores.fill(Number.NaN, 0, OPTION_COUNT);
    const choose = (option: number): void => {
      out.option = option;
      out.tile = s.targetTile[option] ?? -1;
      scores[option] = 1;
    };
    const fraction = s.reserve / s.capacity;
    if (fraction < param(s, P.eatBelow) && s.foodKcal > 0) return choose(OPTION.eat);
    if (s.injury > param(s, P.restIfInjured) && fraction > 0.25) return choose(OPTION.rest);
    if (s.foodKcal < param(s, P.foodTarget)) {
      const bold = param(s, P.riskTolerance) > 0.5 && fraction > 0.5 && s.injury === 0;
      for (const option of bold ? BOLD_FIRST : SAFE_FIRST) {
        if (available(s, option)) return choose(option);
      }
    }
    choose(OPTION.wander);
  },
  /** It would eat right now: it carries food and is below its own eating level. */
  shouldInterrupt(s: Senses): boolean {
    return s.foodKcal > 0 && s.reserve / s.capacity < param(s, P.eatBelow);
  },
};

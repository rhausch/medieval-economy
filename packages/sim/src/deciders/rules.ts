import { OPTION, OPTION_COUNT } from '../data/actions';
import { nearestPlace } from './memory';
import { param, type DeciderDef, type Intent, type Senses } from './types';

const P = {
  eatBelow: 0,
  foodTarget: 1,
  riskTolerance: 2,
  restIfInjured: 3,
  giveUp: 4,
  maxAge: 5,
};

/** Try safe work first, or the risky high-yield work first when the Folk is bold and well fed. */
const SAFE_FIRST = [OPTION.gather, OPTION.snare, OPTION.dig, OPTION.chase];
const BOLD_FIRST = [OPTION.dig, OPTION.chase, OPTION.gather, OPTION.snare];

/** The remembered place to go to for an option, or -1: safe enough, worth it, and not too old a memory. */
function place(s: Senses, option: number): number {
  const def = s.settings.actions.find((a) => a.option === option);
  if (!def || s.roomKg < 0.5) return -1;
  // Nobody starving goes after something that can seriously hurt them.
  if (def.seriousInjury > 0 && s.reserve < 0.4 * s.capacity) return -1;
  // Plants are worked only down to the level the Folk gives up at; leaving some lets the patch recover.
  const minAmount =
    def.kind === 'plant' ? Math.max(def.minStock, param(s, P.giveUp)) : def.minStock;
  return nearestPlace(s, option, minAmount, param(s, P.maxAge));
}

/**
 * Rule-based baseline: eat when the reserve runs low, rest when hurt, restock food from the places it remembers,
 * explore when it remembers nothing worth going to, otherwise wander. Parameters: reserve level to eat at (share
 * of capacity), how much food to carry (kcal), risk tolerance, the injury level above which it rests, how much
 * of a plant it leaves when it moves on (kg), and how old a memory it still trusts (ticks).
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
    { key: 'giveUp', label: 'Leaves plants at (kg)', min: 1, max: 30 },
    { key: 'maxAge', label: 'Trusts memories (ticks)', min: 1000, max: 60000 },
  ],
  decide(s: Senses, out: Intent, scores: Float32Array): void {
    scores.fill(Number.NaN, 0, OPTION_COUNT);
    const choose = (option: number, tile: number): void => {
      out.option = option;
      out.tile = tile;
      scores[option] = 1;
    };
    const fraction = s.reserve / s.capacity;
    if (fraction < param(s, P.eatBelow) && s.foodKcal > 0) return choose(OPTION.eat, -1);
    if (s.injury > param(s, P.restIfInjured) && fraction > 0.25) return choose(OPTION.rest, -1);
    if (s.foodKcal < param(s, P.foodTarget)) {
      const bold = param(s, P.riskTolerance) > 0.5 && fraction > 0.5 && s.injury === 0;
      for (const option of bold ? BOLD_FIRST : SAFE_FIRST) {
        const i = place(s, option);
        if (i >= 0) return choose(option, s.memTile[i]!);
      }
      // Nothing remembered is worth going to: go and look somewhere new.
      if (s.exploreTile >= 0) return choose(OPTION.explore, s.exploreTile);
    }
    choose(OPTION.wander, -1);
  },
  /** It would eat right now: it carries food and is below its own eating level. */
  shouldInterrupt(s: Senses): boolean {
    return s.foodKcal > 0 && s.reserve / s.capacity < param(s, P.eatBelow);
  },
};

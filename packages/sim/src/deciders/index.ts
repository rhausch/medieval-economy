import { RULES } from './rules';
import { UTILITY } from './utility';
import type { DeciderDef } from './types';

export const DECIDERS: readonly DeciderDef[] = [RULES, UTILITY];

export function deciderByKey(key: string): DeciderDef {
  const found = DECIDERS.find((d) => d.key === key);
  if (!found) throw new Error(`unknown decider ${key}`);
  return found;
}

export {
  MAX_PARAMS,
  param,
  type DeciderDef,
  type Intent,
  type ParamSpec,
  type Senses,
} from './types';

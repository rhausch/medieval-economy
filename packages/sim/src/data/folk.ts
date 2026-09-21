/** What a Folk can be doing, for display and accounting. */
export const FOLK_ACTIONS = [
  'idle',
  'moving',
  'eating',
  'resting',
  'gathering',
  'digging',
  'snaring',
  'chasing',
] as const;
export type FolkAction = (typeof FOLK_ACTIONS)[number];

export const INJURY_NAMES = ['none', 'minor', 'serious'] as const;

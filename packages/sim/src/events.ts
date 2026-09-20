/** Things that happen in the sim, drained by the server or CLI and written to the run log. */
export type SimEvent =
  | {
      tick: number;
      type: 'spawn';
      folk: number;
      x: number;
      y: number;
      reason: 'initial' | 'replacement';
    }
  | { tick: number; type: 'eat'; folk: number; x: number; y: number; food: number; satiety: number }
  | { tick: number; type: 'die'; folk: number; x: number; y: number; cause: 'starvation' }
  | {
      tick: number;
      type: 'move';
      folk: number;
      x: number;
      y: number;
      fromX: number;
      fromY: number;
    };

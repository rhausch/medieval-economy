/** Things that happen in the sim, drained by the server or CLI and written to the run log. */
export type SimEvent =
  | {
      tick: number;
      type: 'spawn';
      folk: number;
      x: number;
      y: number;
      reason: 'initial' | 'replacement';
      decider: string;
      /** The Folk's decider parameters, in the decider's parameter order. */
      params: number[];
    }
  | { tick: number; type: 'eat'; folk: number; x: number; y: number; food: number; satiety: number }
  | {
      tick: number;
      type: 'gather';
      folk: number;
      x: number;
      y: number;
      species: string;
      amount: number;
    }
  | {
      tick: number;
      type: 'hunt';
      folk: number;
      x: number;
      y: number;
      species: string;
      success: boolean;
      meat: number;
    }
  | {
      tick: number;
      type: 'injure';
      folk: number;
      x: number;
      y: number;
      severity: 'minor' | 'serious';
      action: string;
    }
  | { tick: number; type: 'heal'; folk: number; x: number; y: number; severity: 'none' | 'minor' }
  | {
      tick: number;
      type: 'die';
      folk: number;
      x: number;
      y: number;
      cause: 'starvation' | 'injury';
      /** Ticks the Folk lived, and its lifetime counters (meals, food by kind, energy spent, ...). */
      lived: number;
      stats: Record<string, number>;
    }
  | {
      tick: number;
      type: 'move';
      folk: number;
      x: number;
      y: number;
      fromX: number;
      fromY: number;
    };

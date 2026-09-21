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
      /** Starting calorie reserve, and the terrain it appeared on. */
      reserve: number;
      terrain: string;
    }
  | {
      tick: number;
      type: 'eat';
      folk: number;
      x: number;
      y: number;
      kg: number;
      kcal: number;
      /** The reserve after eating. */
      reserve: number;
    }
  | {
      tick: number;
      type: 'gather';
      folk: number;
      x: number;
      y: number;
      species: string;
      kg: number;
    }
  | {
      tick: number;
      type: 'hunt';
      folk: number;
      x: number;
      y: number;
      species: string;
      success: boolean;
      kg: number;
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
      /** Ticks the Folk lived, and its lifetime counters (meals, calories in and out, food by kind, ...). */
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
    }
  | {
      tick: number;
      type: 'goal';
      folk: number;
      x: number;
      y: number;
      /** What the Folk set out to do, and the tile it is heading for. */
      option: string;
      targetX: number;
      targetY: number;
      /** Estimated ticks of walking to get there. */
      ticks: number;
    }
  | {
      tick: number;
      type: 'interrupt';
      folk: number;
      x: number;
      y: number;
      option: string;
      /** Why the Folk dropped its goal on the way. */
      reason: 'hungry' | 'depleted';
    };

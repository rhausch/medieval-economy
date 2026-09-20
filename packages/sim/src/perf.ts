/**
 * Timing statistics. The sim never reads a clock itself: a caller injects `timer` (for example
 * `performance.now`), so simulation results stay deterministic and timing is opt-in.
 */
const BUCKETS = 128;

/** Count, total, max and a log-scale histogram (quarter-octave buckets, in microseconds). */
export class TimingStat {
  count = 0;
  totalMs = 0;
  maxMs = 0;
  private readonly buckets = new Uint32Array(BUCKETS);

  record(ms: number): void {
    this.count += 1;
    this.totalMs += ms;
    if (ms > this.maxMs) this.maxMs = ms;
    const micros = Math.max(ms * 1000, 1);
    this.buckets[Math.min(BUCKETS - 1, Math.floor(4 * Math.log2(micros)))]! += 1;
  }

  /** Approximate quantile in milliseconds (accurate to about 19%), never above the true maximum. */
  quantileMs(q: number): number {
    if (this.count === 0) return 0;
    const target = Math.max(1, Math.ceil(q * this.count));
    let seen = 0;
    for (let b = 0; b < BUCKETS; b++) {
      seen += this.buckets[b]!;
      if (seen >= target) return Math.min(this.maxMs, 2 ** ((b + 1) / 4) / 1000);
    }
    return this.maxMs;
  }

  reset(): void {
    this.count = 0;
    this.totalMs = 0;
    this.maxMs = 0;
    this.buckets.fill(0);
  }

  get meanMs(): number {
    return this.count === 0 ? 0 : this.totalMs / this.count;
  }
}

export interface Perf {
  readonly timer: () => number;
  /** Whole `step()` calls, and the ecology and Folk phases within them. */
  readonly step: TimingStat;
  readonly ecology: TimingStat;
  readonly folk: TimingStat;
  /** The shared search for work, run before every decision. */
  readonly scan: TimingStat;
  /** One entry per decider (indexed like DECIDERS): the decider's own `decide()` call. */
  readonly decide: TimingStat[];
}

export function createPerf(timer: () => number, deciderCount: number): Perf {
  return {
    timer,
    step: new TimingStat(),
    ecology: new TimingStat(),
    folk: new TimingStat(),
    scan: new TimingStat(),
    decide: Array.from({ length: deciderCount }, () => new TimingStat()),
  };
}

export interface TimingSummary {
  count: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export function summarize(stat: TimingStat): TimingSummary {
  return {
    count: stat.count,
    meanMs: stat.meanMs,
    p50Ms: stat.quantileMs(0.5),
    p95Ms: stat.quantileMs(0.95),
    p99Ms: stat.quantileMs(0.99),
    maxMs: stat.maxMs,
  };
}

/** Clear all timing statistics (e.g. after a warm-up). */
export function resetPerf(perf: Perf): void {
  for (const stat of [perf.step, perf.ecology, perf.folk, perf.scan, ...perf.decide]) stat.reset();
}

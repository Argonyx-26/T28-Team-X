/**
 * Marking-time bookkeeping for snap mode: the wall-clock seconds between consecutive captures is the human time
 * per notebook (flip, hold, capture). Pure functions over timestamps. Internal measurement, not a teacher study.
 */

export interface Interval {
  /** 1-based index of the capture that ended the interval */
  page: number;
  /** seconds since the previous capture */
  seconds: number;
  /** ms since the epoch when this capture happened */
  at: number;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface TimingSummary {
  pages: number;
  intervals: Interval[];
  medianSeconds: number | null;
  meanSeconds: number | null;
  totalSeconds: number;
}

/** `captures`: the ms timestamps of every capture in order. `now`: for the running total. */
export function summarise(captures: number[], now: number): TimingSummary {
  const intervals: Interval[] = [];
  for (let i = 1; i < captures.length; i++) {
    intervals.push({ page: i + 1, seconds: (captures[i] - captures[i - 1]) / 1000, at: captures[i] });
  }
  const seconds = intervals.map((x) => x.seconds);
  return {
    pages: captures.length,
    intervals,
    medianSeconds: median(seconds),
    meanSeconds: seconds.length ? seconds.reduce((a, b) => a + b, 0) / seconds.length : null,
    totalSeconds: captures.length ? (now - captures[0]) / 1000 : 0,
  };
}

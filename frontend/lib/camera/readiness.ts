/**
 * The auto-capture decision: a small state machine fed one grayscale sample at a time.
 *
 * A capture fires when the frame is
 *   (a) steady: consecutive samples differ by less than `steadyMaxDiff` for at least `steadyMs`,
 *   (b) sharp: the Laplacian variance is at least `sharpMin`,
 *   (c) new: it differs from the last capture. Two signals, either is enough: the Hamming distance of the 8 x 8
 *       average hash is at least `novelHamming` (a wholly different scene), or the share of ink that moved is at
 *       least `novelInk` (the next student's page: the same layout, different numbers, which the hash cannot see).
 *
 * Pure: time comes in as an argument, so it is testable without a camera.
 */

import { type GrayFrame, averageHash, hamming, inkChange, laplacianVariance, meanAbsDiff } from "./frame";

export interface Thresholds {
  /** ms of consecutive steady samples before a capture may fire */
  steadyMs: number;
  /** mean absolute difference (0..255) between consecutive samples below which the camera counts as still */
  steadyMaxDiff: number;
  /** Laplacian variance at or above which the sample counts as in focus (for a 160 x 120 sample) */
  sharpMin: number;
  /** Hamming distance (0..64) between average hashes at or above which the page counts as a new one */
  novelHamming: number;
  /** share of ink (0..1) with no counterpart in the last capture at or above which the page counts as a new one */
  novelInk: number;
  /** ms after a capture during which nothing fires, so one page turn never yields two photos */
  cooldownMs: number;
}

/**
 * Calibrated on the e2e fixture (e2e/fixtures/pages.y4m sampled at 160 x 120, 10 samples/s): a held page measures
 * diff 0–4.3 and Laplacian variance 3,960–4,620; the blurred page turn measures diff 8–9 and variance 1–4; the same
 * page drifting by up to 4 sample pixels scores ink change 0.00–0.12, and the next page (same layout, different
 * numbers) scores 0.50 while its average hash differs by only 1 bit. A real phone over a notebook is untested at the
 * time of writing: if the indicator sits on "Too blurry" with a page clearly in focus, lower `sharpMin`; if it fires
 * while the page is still moving, lower `steadyMaxDiff`.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  steadyMs: 600,
  steadyMaxDiff: 6,
  sharpMin: 60,
  novelHamming: 6,
  novelInk: 0.3,
  cooldownMs: 1500,
};

export type Reason = "warming" | "moving" | "blurry" | "same" | "ready" | "cooldown";

export interface Readiness {
  /** why it has or hasn't fired, for the indicator */
  reason: Reason;
  /** true on the one sample where a capture should be taken */
  capture: boolean;
  /** the measures, for a debug line */
  diff: number;
  sharpness: number;
  steadyFor: number;
  /** distance from the last capture (null before the first) */
  novelty: { hamming: number; ink: number } | null;
}

export const REASON_TEXT: Record<Reason, string> = {
  warming: "Point the camera at the page",
  moving: "Hold steady…",
  blurry: "Too blurry: hold still or move a little further away",
  same: "Same page as before. Turn to the next one",
  ready: "Sharp ✓",
  cooldown: "Got it ✓",
};

export class ReadinessTracker {
  private prev: GrayFrame | null = null;
  private prevAt = 0;
  private steadyFor = 0;
  private lastCapture: { gray: GrayFrame; hash: Uint8Array; at: number } | null = null;

  constructor(private readonly t: Thresholds = DEFAULT_THRESHOLDS) {}

  /** Feeds one sample. `now` in ms (performance.now() or any monotonic clock). */
  feed(gray: GrayFrame, now: number): Readiness {
    const sharpness = laplacianVariance(gray);
    const hadPrev = this.prev !== null;
    let diff = 255;
    if (this.prev) {
      diff = meanAbsDiff(this.prev, gray);
      const dt = Math.max(0, now - this.prevAt);
      this.steadyFor = diff < this.t.steadyMaxDiff ? this.steadyFor + dt : 0;
    }
    this.prev = gray;
    this.prevAt = now;

    const base = { diff, sharpness, steadyFor: this.steadyFor, novelty: null, capture: false };
    if (this.lastCapture && now - this.lastCapture.at < this.t.cooldownMs) return { ...base, reason: "cooldown" };
    if (!hadPrev) return { ...base, reason: "warming" };
    if (this.steadyFor < this.t.steadyMs) return { ...base, reason: "moving" };
    if (sharpness < this.t.sharpMin) return { ...base, reason: "blurry" };
    // the novelty check is the expensive one (~10 ms), so it runs only once the frame is steady and sharp
    if (this.lastCapture) {
      const novelty = {
        hamming: hamming(averageHash(gray), this.lastCapture.hash),
        ink: inkChange(this.lastCapture.gray, gray),
      };
      const isNew = novelty.hamming >= this.t.novelHamming || novelty.ink >= this.t.novelInk;
      if (!isNew) return { ...base, novelty, reason: "same" };
      return { ...base, novelty, reason: "ready", capture: true };
    }
    return { ...base, reason: "ready", capture: true };
  }

  /** Call after a capture (auto or manual) so the next page must differ from this one. */
  markCaptured(gray: GrayFrame, now: number): void {
    this.lastCapture = { gray, hash: averageHash(gray), at: now };
    this.steadyFor = 0;
  }

  reset(): void {
    this.prev = null;
    this.steadyFor = 0;
    this.lastCapture = null;
  }
}

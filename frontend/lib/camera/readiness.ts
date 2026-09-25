/**
 * The auto-capture decision: a small state machine fed one grayscale sample at a time.
 *
 * A capture fires when the frame is
 *   (a) steady: consecutive samples differ by less than `steadyMaxDiff` for at least `steadyMs`,
 *   (b) sharp: the Laplacian variance is at least `sharpMin`,
 *   (c) new: since the last capture the page was turned. Any one of three signs: the view went badly out of focus
 *       (sharpness under half of `sharpMin`: a page flipping close to the lens, a hand over it), it kept moving for at
 *       least `turnMs` (the next notebook sliding in; shake is a jolt of one or two samples), or it changed by at
 *       least `rearmDiff` from the captured sample (a hand across the page). Holding still over the same page does
 *       none of these, so one page is never captured twice by holding still.
 *
 * Measured on six real handwritten pages (data/evidence/incoming/*_roll*_a.jpg) rendered as 160 x 120 samples on a
 * light and a dark desk: hand shake of up to 3 sample pixels changes the view by 7.6–11.4, a hand in view or a
 * turned page by 12.9–25.2. An earlier rule compared the ink of the two frames; on real pages it called the same
 * page new under ordinary shake (so it captured one page every two seconds) and called Roll 4 then Roll 5 the same.
 * Two different real pages differ by only 7.7–13.4, inside the shake range, so no comparison of two still frames can
 * tell a new page from shake: the turn itself is the signal. A sharp page scores a Laplacian variance of 370–522 and
 * a 6 px blur at full size 83–107, so `sharpMin` is 120.
 *
 * Pure: time comes in as an argument, so it is testable without a camera.
 */

import { type GrayFrame, laplacianVariance, meanAbsDiff } from "./frame";

export interface Thresholds {
  /** ms of consecutive steady samples before a capture may fire */
  steadyMs: number;
  /** mean absolute difference (0..255) between consecutive samples below which the camera counts as still */
  steadyMaxDiff: number;
  /** Laplacian variance at or above which the sample counts as in focus (for a 160 x 120 sample) */
  sharpMin: number;
  /** change from the last capture (mean absolute difference, 0..255) that shows the page was turned or swapped */
  rearmDiff: number;
  /** ms of continuous movement (consecutive samples at or above `steadyMaxDiff`) that counts as a page turn */
  turnMs: number;
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
  sharpMin: 120,
  rearmDiff: 14,
  turnMs: 300,
  cooldownMs: 1500,
};

/** below this mean difference two samples are the same video frame (sensor noise alone is about 2) */
const SAME_FRAME = 0.5;

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
  /** since the last capture: the largest change from it, and whether a turn was seen (null before the first) */
  novelty: { away: number; turned: boolean } | null;
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
  private lastCapture: { gray: GrayFrame; at: number } | null = null;
  /** the most the view has changed from the last capture since it was taken */
  private away = 0;
  /** when the current run of movement began (null while still) */
  private movingSince: number | null = null;
  private turned = false;

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
      // a repeated video frame (the camera is slower than the sampling, as in dim light) says nothing about motion:
      // it neither extends nor ends a run of movement
      if (diff >= SAME_FRAME) {
        if (diff >= this.t.steadyMaxDiff) this.movingSince ??= this.prevAt;
        else this.movingSince = null;
      }
      if (this.lastCapture && this.movingSince !== null && now - this.movingSince >= this.t.turnMs) this.turned = true;
    }
    this.prev = gray;
    this.prevAt = now;

    if (this.lastCapture) this.away = Math.max(this.away, meanAbsDiff(this.lastCapture.gray, gray));
    if (this.away >= this.t.rearmDiff || (this.lastCapture && sharpness < this.t.sharpMin / 2)) this.turned = true;
    const novelty = this.lastCapture ? { away: this.away, turned: this.turned } : null;
    const base = { diff, sharpness, steadyFor: this.steadyFor, novelty, capture: false };
    if (this.lastCapture && now - this.lastCapture.at < this.t.cooldownMs) return { ...base, reason: "cooldown" };
    if (!hadPrev) return { ...base, reason: "warming" };
    if (this.steadyFor < this.t.steadyMs) return { ...base, reason: "moving" };
    if (sharpness < this.t.sharpMin) return { ...base, reason: "blurry" };
    if (this.lastCapture && !this.turned) return { ...base, reason: "same" };
    return { ...base, reason: "ready", capture: true };
  }

  /** Call after a capture (auto or manual) so the next page must differ from this one. */
  markCaptured(gray: GrayFrame, now: number): void {
    this.lastCapture = { gray, at: now };
    this.away = 0;
    this.movingSince = null;
    this.turned = false;
    this.steadyFor = 0;
  }

  reset(): void {
    this.prev = null;
    this.steadyFor = 0;
    this.lastCapture = null;
    this.away = 0;
    this.movingSince = null;
    this.turned = false;
  }
}

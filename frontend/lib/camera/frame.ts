/**
 * Pure image measures for auto-capture. Everything here takes plain numbers and typed arrays, so it runs the
 * same in the browser, in Node and inside a Playwright `page.evaluate`. No DOM, no canvas.
 *
 * A "frame" is the small grayscale sample the camera loop takes ~10 times a second (about 160 x 120).
 */

/** The RGBA pixels of an ImageData, or anything shaped like one. */
export interface RgbaFrame {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface GrayFrame {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Luma (Rec. 601 weights) of every pixel, 0..255. */
export function toGray(frame: RgbaFrame): GrayFrame {
  const { data, width, height } = frame;
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }
  return { data: out, width, height };
}

/** Mean absolute difference between two same-sized frames, 0..255. Motion, in plain units. */
export function meanAbsDiff(a: GrayFrame, b: GrayFrame): number {
  if (a.width !== b.width || a.height !== b.height) return 255;
  const n = a.data.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / n;
}

/**
 * Focus measure: the variance of the 4-neighbour Laplacian over the interior pixels. Edges (ink on paper) give a
 * large response; blur flattens it. Scale-dependent: calibrated for the 160 x 120 sample.
 */
export function laplacianVariance(frame: GrayFrame): number {
  const { data, width, height } = frame;
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const v = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - width] - data[i + width];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * Perceptual "average hash": the frame shrunk to 8 x 8 by box averaging, each cell 1 if brighter than the mean.
 * Returned as 64 bits packed in a Uint8Array(8), so two hashes compare with a Hamming distance.
 */
export function averageHash(frame: GrayFrame): Uint8Array {
  const cells = new Float64Array(64);
  const { data, width, height } = frame;
  const counts = new Uint32Array(64);
  for (let y = 0; y < height; y++) {
    const cy = Math.min(7, Math.floor((y * 8) / height));
    for (let x = 0; x < width; x++) {
      const cx = Math.min(7, Math.floor((x * 8) / width));
      const c = cy * 8 + cx;
      cells[c] += data[y * width + x];
      counts[c]++;
    }
  }
  let mean = 0;
  for (let c = 0; c < 64; c++) {
    cells[c] = counts[c] ? cells[c] / counts[c] : 0;
    mean += cells[c];
  }
  mean /= 64;
  const bits = new Uint8Array(8);
  for (let c = 0; c < 64; c++) if (cells[c] > mean) bits[c >> 3] |= 1 << (c & 7);
  return bits;
}

/** How many of the 64 bits differ. 0 = the same picture, ~32 = unrelated pictures. */
export function hamming(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = a[i] ^ b[i];
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/**
 * Ink mask: 1 where a pixel is clearly darker than the paper (below the mean by `contrast`). Adaptive, so it works
 * on a shaded page as well as a bright one.
 */
export function inkMask(frame: GrayFrame, contrast = 40): Uint8Array {
  const { data } = frame;
  let mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= Math.max(1, data.length);
  const out = new Uint8Array(data.length);
  const cut = mean - contrast;
  for (let i = 0; i < data.length; i++) out[i] = data[i] < cut ? 1 : 0;
  return out;
}

/** Grows every ink pixel by `r` pixels in each direction, so a slightly shifted page still overlaps itself. */
export function dilate(mask: Uint8Array, width: number, height: number, r = 1): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < width) out[yy * width + xx] = 1;
        }
      }
    }
  }
  return out;
}

export interface InkChangeOptions {
  /** the two masks are aligned first: every offset within ±search pixels is tried and the best match counts */
  search: number;
  /** how far ink may sit from its counterpart and still match (0 = exact pixel) */
  tolerance: number;
}

export const INK_CHANGE_DEFAULTS: InkChangeOptions = { search: 4, tolerance: 0 };

/**
 * How much of the writing changed between two frames, 0..1: the larger share of either frame's ink that has no
 * counterpart in the other, after sliding one over the other by up to `search` pixels to cancel a hand's drift.
 * Two shots of the same page score near 0; the next student's page (the same layout, different numbers, where an
 * 8 x 8 average hash barely moves) scores well above the threshold.
 * Returns 1 when either frame has (almost) no ink at all, which counts as "a different thing in front of the camera".
 */
export function inkChange(a: GrayFrame, b: GrayFrame, opts: InkChangeOptions = INK_CHANGE_DEFAULTS): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const { width, height } = a;
  const ma = inkMask(a);
  const mb = inkMask(b);
  const da = opts.tolerance > 0 ? dilate(ma, width, height, opts.tolerance) : ma;
  const db = opts.tolerance > 0 ? dilate(mb, width, height, opts.tolerance) : mb;
  let inkA = 0;
  let inkB = 0;
  for (let i = 0; i < ma.length; i++) {
    inkA += ma[i];
    inkB += mb[i];
  }
  const minInk = Math.max(20, ma.length / 400); // a 160 x 120 sample needs ≥ 48 ink pixels to count as writing
  if (inkA < minInk || inkB < minInk) return 1;

  let best = 1;
  for (let dy = -opts.search; dy <= opts.search; dy++) {
    for (let dx = -opts.search; dx <= opts.search; dx++) {
      // compare A at (x, y) with B at (x + dx, y + dy); ink that falls outside the other frame counts as missing
      let aMissing = 0;
      let bMissing = 0;
      for (let y = 0; y < height; y++) {
        const yb = y + dy;
        const rowOk = yb >= 0 && yb < height;
        for (let x = 0; x < width; x++) {
          const xb = x + dx;
          const inside = rowOk && xb >= 0 && xb < width;
          const i = y * width + x;
          const j = yb * width + xb;
          if (ma[i] && !(inside && db[j])) aMissing++;
          if (inside && mb[j] && !da[i]) bMissing++;
        }
      }
      // ink of B that the window never visited still counts: add B's ink outside the overlap
      const outsideB = inkB - countInside(mb, width, height, dx, dy);
      const score = Math.max(aMissing / inkA, (bMissing + outsideB) / inkB);
      if (score < best) best = score;
    }
  }
  return best;
}

/** Ink pixels of `mask` whose position (x + dx, y + dy) lies inside the frame, i.e. those the overlap covers. */
function countInside(mask: Uint8Array, width: number, height: number, dx: number, dy: number): number {
  let n = 0;
  for (let y = Math.max(0, dy); y < Math.min(height, height + dy); y++) {
    const row = y * width;
    for (let x = Math.max(0, dx); x < Math.min(width, width + dx); x++) n += mask[row + x];
  }
  return n;
}

/**
 * Pure-JS 4-anchor detection for the mobile scan identity page.
 *
 * The answer sheet has 4 solid black square anchors at its corners (the same
 * references the Python OMR processor uses, see backend/omr-service/
 * omr_processor.py). Detecting them in the browser lets us auto-capture page 1
 * the instant the sheet is squared up — the lowest-latency trigger.
 *
 * This is deliberately dependency-free (no OpenCV.js / WASM): the full OpenCV.js
 * build is ~9.8 MB and freezes a phone's main thread while it parses. The
 * anchors are simple solid squares near the corners, so a small per-corner
 * threshold + connected-components search is plenty — and the backend re-runs
 * the authoritative OMR (warp + MSSV + alignment) on the captured frame anyway.
 */

export type AnchorPoint = { x: number; y: number };

// Expected anchor centres as fractions of the A4 sheet — matches the canonical
// geometry used by the OMR processor and the on-screen overlay.
const TARGETS: ReadonlyArray<{ fx: number; fy: number }> = [
  { fx: 0.0476, fy: 0.0337 }, // TL
  { fx: 0.9524, fy: 0.0337 }, // TR
  { fx: 0.9524, fy: 0.9663 }, // BR
  { fx: 0.0476, fy: 0.9663 }, // BL
];

const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

/**
 * Find the anchor-like blob nearest (targetX,targetY) within a corner ROI of the
 * grayscale image. Returns its centroid in full-image coords, or null.
 */
const findCornerAnchor = (
  gray: Uint8ClampedArray,
  W: number,
  H: number,
  targetX: number,
  targetY: number
): AnchorPoint | null => {
  // ROI: a generous box around the corner (absorbs tilt / framing offset).
  const roiW = Math.round(W * 0.3);
  const roiH = Math.round(H * 0.22);
  const x0 = Math.max(0, Math.min(W - roiW, Math.round(targetX - roiW / 2)));
  const y0 = Math.max(0, Math.min(H - roiH, Math.round(targetY - roiH / 2)));
  const rw = Math.min(W, x0 + roiW) - x0;
  const rh = Math.min(H, y0 + roiH) - y0;
  if (rw < 6 || rh < 6) return null;

  // Local threshold from ROI min/max; require enough contrast (i.e. a real mark).
  let lo = 255;
  let hi = 0;
  for (let y = 0; y < rh; y += 1) {
    const row = (y0 + y) * W + x0;
    for (let x = 0; x < rw; x += 1) {
      const v = gray[row + x];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (hi - lo < 40) return null;
  const thr = lo + (hi - lo) * 0.45;

  // Connected components of dark pixels (4-neighbour flood fill within the ROI).
  const labels = new Int8Array(rw * rh); // 0 unvisited, 1 dark-visited, 2 not-dark
  const stack: number[] = [];
  const minArea = Math.max(8, Math.round(W * H * 0.0001));
  const maxArea = Math.round(W * H * 0.012);
  const isDark = (lx: number, ly: number): boolean => gray[(y0 + ly) * W + (x0 + lx)] < thr;

  let best: AnchorPoint | null = null;
  let bestDist = Infinity;

  for (let sy = 0; sy < rh; sy += 1) {
    for (let sx = 0; sx < rw; sx += 1) {
      const start = sy * rw + sx;
      if (labels[start] !== 0) continue;
      if (!isDark(sx, sy)) {
        labels[start] = 2;
        continue;
      }
      stack.length = 0;
      stack.push(start);
      labels[start] = 1;
      let area = 0;
      let sumX = 0;
      let sumY = 0;
      let bx0 = sx;
      let bx1 = sx;
      let by0 = sy;
      let by1 = sy;
      while (stack.length) {
        const cur = stack.pop() as number;
        const cy = (cur / rw) | 0;
        const cx = cur - cy * rw;
        area += 1;
        sumX += cx;
        sumY += cy;
        if (cx < bx0) bx0 = cx;
        if (cx > bx1) bx1 = cx;
        if (cy < by0) by0 = cy;
        if (cy > by1) by1 = cy;
        if (cx > 0) {
          const n = cur - 1;
          if (labels[n] === 0) {
            if (isDark(cx - 1, cy)) { labels[n] = 1; stack.push(n); } else labels[n] = 2;
          }
        }
        if (cx < rw - 1) {
          const n = cur + 1;
          if (labels[n] === 0) {
            if (isDark(cx + 1, cy)) { labels[n] = 1; stack.push(n); } else labels[n] = 2;
          }
        }
        if (cy > 0) {
          const n = cur - rw;
          if (labels[n] === 0) {
            if (isDark(cx, cy - 1)) { labels[n] = 1; stack.push(n); } else labels[n] = 2;
          }
        }
        if (cy < rh - 1) {
          const n = cur + rw;
          if (labels[n] === 0) {
            if (isDark(cx, cy + 1)) { labels[n] = 1; stack.push(n); } else labels[n] = 2;
          }
        }
      }
      if (area < minArea || area > maxArea) continue;
      const bw = bx1 - bx0 + 1;
      const bh = by1 - by0 + 1;
      const aspect = bw / Math.max(1, bh);
      if (aspect < 0.5 || aspect > 2.0) continue;
      if (area / (bw * bh) < 0.55) continue; // solid square, not a thin stroke
      const ccx = x0 + sumX / area;
      const ccy = y0 + sumY / area;
      const d = dist(ccx, ccy, targetX, targetY);
      if (d < bestDist) {
        bestDist = d;
        best = { x: ccx, y: ccy };
      }
    }
  }
  return best;
};

/**
 * Detect the 4 corner anchors in a canvas that is already cover-cropped to the
 * A4 aspect (the same crop the capture uses). Returns the 4 centres ordered
 * [TL, TR, BR, BL] in canvas-pixel coordinates, or null if a confident,
 * full-page quad of anchors was not found.
 */
export const detectAnchorQuad = (canvas: HTMLCanvasElement): AnchorPoint[] | null => {
  const W = canvas.width;
  const H = canvas.height;
  if (W < 80 || H < 80) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const { data } = ctx.getImageData(0, 0, W, H);
  const gray = new Uint8ClampedArray(W * H);
  for (let i = 0, p = 0; p < gray.length; i += 4, p += 1) {
    gray[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }

  const quad: AnchorPoint[] = [];
  for (const t of TARGETS) {
    const targetX = t.fx * W;
    const targetY = t.fy * H;
    const found = findCornerAnchor(gray, W, H, targetX, targetY);
    if (!found) return null;
    // The detector is used as an auto-capture trigger, so be conservative: a
    // corner-like blob must sit close to the printed anchor position in the A4
    // crop, not merely somewhere inside the corner search window.
    if (dist(found.x, found.y, targetX, targetY) > 0.075 * Math.min(W, H)) return null;
    quad.push(found);
  }

  // The 4 anchors must span most of the frame (rejects interior false hits) and
  // roughly match A4 proportions.
  const [TL, TR, BR, BL] = quad;
  const top = dist(TL.x, TL.y, TR.x, TR.y);
  const bottom = dist(BL.x, BL.y, BR.x, BR.y);
  const left = dist(TL.x, TL.y, BL.x, BL.y);
  const right = dist(TR.x, TR.y, BR.x, BR.y);
  if (Math.min(top, bottom, left, right) < 0.55 * Math.min(W, H)) return null;
  if (Math.abs(top - bottom) / Math.max(top, bottom) > 0.22) return null;
  if (Math.abs(left - right) / Math.max(left, right) > 0.22) return null;
  const ratio = (top + bottom) / 2 / Math.max(1, (left + right) / 2);
  if (ratio < 0.5 || ratio > 0.85) return null;

  return quad;
};

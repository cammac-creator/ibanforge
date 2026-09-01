/**
 * naturalPath — turns an axis-aligned road route into a stroll.
 *
 * Three passes over the waypoints the road router emits:
 *   1. corners are cut wide (entry/exit points either side of each 90° turn),
 *   2. long straights gain gently swayed midpoints (deterministic sine sway,
 *      so replaying a quest draws the same walk),
 *   3. a Catmull-Rom spline threads every control point and is sampled in
 *      ~12px steps for the engine's constant-speed follower.
 *
 * The result never leaves the street: the sway amplitude plus the corner
 * shortcut stay well inside the 24px road bands (path.test.ts pins ≤ 12px).
 */

type P = [number, number];

const CORNER_R = 26;
const SWAY_AMP = 4.5;
const SWAY_EVERY = 70;
const SAMPLE_STEP = 12;

function catmullRom(ctrl: P[], step: number): P[] {
  if (ctrl.length < 3) return ctrl.slice();
  const pts = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  const out: P[] = [ctrl[0]];
  for (let i = 1; i < pts.length - 2; i++) {
    const [p0x, p0y] = pts[i - 1];
    const [p1x, p1y] = pts[i];
    const [p2x, p2y] = pts[i + 1];
    const [p3x, p3y] = pts[i + 2];
    const n = Math.max(1, Math.round(Math.hypot(p2x - p1x, p2y - p1y) / step));
    for (let j = 1; j <= n; j++) {
      const t = j / n;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1x + (p2x - p0x) * t + (2 * p0x - 5 * p1x + 4 * p2x - p3x) * t2 + (3 * p1x - p0x - 3 * p2x + p3x) * t3),
        0.5 * (2 * p1y + (p2y - p0y) * t + (2 * p0y - 5 * p1y + 4 * p2y - p3y) * t2 + (3 * p1y - p0y - 3 * p2y + p3y) * t3),
      ]);
    }
  }
  out[out.length - 1] = ctrl[ctrl.length - 1];
  return out;
}

export function naturalPath(raw: P[]): P[] {
  const pts: P[] = [];
  for (const p of raw) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.01) pts.push([p[0], p[1]]);
  }
  if (pts.length === 0) return [];
  if (pts.length === 1) return raw.length > 1 ? [pts[0], pts[0]] : [pts[0]];

  // pass 1 — cut every interior corner wide
  const ctrl: P[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const d1 = Math.hypot(cx - px, cy - py);
    const d2 = Math.hypot(nx - cx, ny - cy);
    const t1 = Math.min(CORNER_R, d1 / 2.4) / d1;
    const t2 = Math.min(CORNER_R, d2 / 2.4) / d2;
    ctrl.push([cx - (cx - px) * t1, cy - (cy - py) * t1]);
    ctrl.push([cx + (nx - cx) * t2, cy + (ny - cy) * t2]);
  }
  ctrl.push(pts[pts.length - 1]);

  // pass 2 — sway the long straights (deterministic: same route, same walk)
  const sway: P[] = [ctrl[0]];
  let k = 0;
  for (let i = 1; i < ctrl.length; i++) {
    const [ax, ay] = ctrl[i - 1];
    const [bx, by] = ctrl[i];
    const d = Math.hypot(bx - ax, by - ay);
    const nSub = Math.floor(d / SWAY_EVERY);
    for (let j = 1; j <= nSub; j++) {
      const t = j / (nSub + 1);
      const off = Math.sin(3 + k * 1.9) * SWAY_AMP;
      k += 1;
      sway.push([ax + (bx - ax) * t - ((by - ay) / d) * off, ay + (by - ay) * t + ((bx - ax) / d) * off]);
    }
    sway.push([bx, by]);
  }

  // pass 3 — thread and sample
  return catmullRom(sway, SAMPLE_STEP);
}

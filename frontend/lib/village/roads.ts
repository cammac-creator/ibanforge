/**
 * The village main street — an S-shaped, axis-aligned polyline — and the
 * routing between two anchors on it. Quest movement is monotonic: stations
 * are laid out in pipeline order along the spine, so a route only ever moves
 * forward (the one detour, the registry lane, is handled by the engine).
 */

export const SPINE: [number, number][] = [
  [-14, 90], [470, 90], [470, 156], [96, 156], [96, 240], [470, 240],
];

/** Scalar position of a point along the spine. Anchors must sit on it. */
function spineS(p: [number, number]): number {
  let s = 0;
  for (let i = 0; i < SPINE.length - 1; i++) {
    const [ax, ay] = SPINE[i], [bx, by] = SPINE[i + 1];
    const seg = Math.abs(bx - ax) + Math.abs(by - ay);
    const onX = ay === by && p[1] === ay
      && p[0] >= Math.min(ax, bx) - 0.01 && p[0] <= Math.max(ax, bx) + 0.01;
    const onY = ax === bx && p[0] === ax
      && p[1] >= Math.min(ay, by) - 0.01 && p[1] <= Math.max(ay, by) + 0.01;
    if (onX) return s + Math.abs(p[0] - ax);
    if (onY) return s + Math.abs(p[1] - ay);
    s += seg;
  }
  return s;
}

/**
 * Waypoints from anchor A to anchor B (A earlier on the spine than B):
 * every spine corner strictly between them, then B itself.
 */
export function roadRoute(a: [number, number], b: [number, number]): [number, number][] {
  const sa = spineS(a), sb = spineS(b);
  const pts: [number, number][] = [];
  let s = 0;
  for (let i = 0; i < SPINE.length - 1; i++) {
    const [ax, ay] = SPINE[i], [bx, by] = SPINE[i + 1];
    const seg = Math.abs(bx - ax) + Math.abs(by - ay);
    const cornerS = s + seg;
    if (cornerS > sa && cornerS < sb) pts.push([bx, by]);
    s = cornerS;
  }
  pts.push(b);
  return pts;
}

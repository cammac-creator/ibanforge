import { describe, expect, it } from 'vitest';

import { naturalPath } from './path';

type P = [number, number];

/** Distance from a point to the nearest segment of a polyline. */
function distToPolyline(p: P, poly: P[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(p[0] - (ax + dx * t), p[1] - (ay + dy * t)));
  }
  return best;
}

// The real spine route the hero walks (top street → east bend → middle street
// → west bend → bottom street), the exact shape quests feed the engine.
const SPINE_ROUTE: P[] = [
  [-28, 192], [932, 192], [932, 342], [202, 342], [202, 498], [952, 498],
];

describe('naturalPath', () => {
  it('preserves both endpoints exactly', () => {
    const out = naturalPath(SPINE_ROUTE);
    expect(out[0]).toEqual(SPINE_ROUTE[0]);
    expect(out[out.length - 1]).toEqual(SPINE_ROUTE[SPINE_ROUTE.length - 1]);
  });

  it('stays inside the street corridor (≤ 12px off the original polyline)', () => {
    const out = naturalPath(SPINE_ROUTE);
    for (const p of out) {
      expect(distToPolyline(p, SPINE_ROUTE)).toBeLessThanOrEqual(12);
    }
  });

  it('walks in small steps and never turns sharper than 50°', () => {
    const out = naturalPath(SPINE_ROUTE);
    expect(out.length).toBeGreaterThan(SPINE_ROUTE.length * 4);
    for (let i = 2; i < out.length; i++) {
      const a1 = Math.atan2(out[i - 1][1] - out[i - 2][1], out[i - 1][0] - out[i - 2][0]);
      const a2 = Math.atan2(out[i][1] - out[i - 1][1], out[i][0] - out[i - 1][0]);
      let d = Math.abs(a2 - a1);
      if (d > Math.PI) d = 2 * Math.PI - d;
      expect(d).toBeLessThanOrEqual((50 * Math.PI) / 180);
    }
  });

  it('sways gently instead of tracing dead-straight rails', () => {
    const straight: P[] = [[0, 100], [400, 100]];
    const out = naturalPath(straight);
    const maxOff = Math.max(...out.map((p) => Math.abs(p[1] - 100)));
    expect(maxOff).toBeGreaterThan(1.5);
    expect(maxOff).toBeLessThanOrEqual(8);
  });

  it('is deterministic for a given input', () => {
    expect(naturalPath(SPINE_ROUTE)).toEqual(naturalPath(SPINE_ROUTE));
  });

  it('passes degenerate inputs through', () => {
    expect(naturalPath([])).toEqual([]);
    expect(naturalPath([[5, 5]])).toEqual([[5, 5]]);
    const pair = naturalPath([[10, 20], [10, 20]]);
    expect(pair[pair.length - 1]).toEqual([10, 20]);
  });
});

import { describe, it, expect } from 'vitest';
import { SPINE, roadRoute } from './roads';

// The road spine of the ART-SCALE world (960×540, Midjourney sprites): west
// entrance on the top street (y=192), east bend down (x=932), westward middle
// street (y=342), south bend (x=202), bottom street east to the exit (y=498).
// Anchors sit ON the polyline, in pipeline order — the quest never backtracks.

describe('roadRoute', () => {
  it('walks straight between two anchors on the same segment', () => {
    expect(roadRoute([80, 192], [430, 192])).toEqual([[430, 192]]);
  });

  it('inserts the corners when the target is around bends', () => {
    // scribe (200,192) → court (716,342): east to the bend, down, then west.
    expect(roadRoute([200, 192], [716, 342])).toEqual([
      [932, 192], [932, 342], [716, 342],
    ]);
  });

  it('reaches the forge through the south bend', () => {
    expect(roadRoute([438, 342], [410, 498])).toEqual([
      [202, 342], [202, 498], [410, 498],
    ]);
  });

  it('spans the full spine from gate to exit', () => {
    expect(roadRoute([80, 192], [952, 498])).toEqual([
      [932, 192], [932, 342], [202, 342], [202, 498], [952, 498],
    ]);
  });

  it('exposes a spine whose consecutive segments are axis-aligned', () => {
    for (let i = 0; i < SPINE.length - 1; i++) {
      const [ax, ay] = SPINE[i], [bx, by] = SPINE[i + 1];
      expect(ax === bx || ay === by).toBe(true);
    }
  });
});

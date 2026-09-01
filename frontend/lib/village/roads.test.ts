import { describe, it, expect } from 'vitest';
import { SPINE, roadRoute } from './roads';

// The road spine is the S-shaped main street: west entrance (y=90), east
// bend down (x=470), westward middle row (y=156), south bend (x=96), and the
// bottom row east to the exit (y=240). Anchors given to roadRoute always sit
// ON that polyline, in pipeline order (monotonic — the quest never backtracks).

describe('roadRoute', () => {
  it('walks straight between two anchors on the same segment', () => {
    expect(roadRoute([38, 90], [217, 90])).toEqual([[217, 90]]);
  });

  it('inserts the corners when the target is around bends', () => {
    // scribe (98,90) → court (353,156): east to the bend, down, then west.
    expect(roadRoute([98, 90], [353, 156])).toEqual([
      [470, 90], [470, 156], [353, 156],
    ]);
  });

  it('reaches the forge through the south bend', () => {
    expect(roadRoute([221, 156], [198, 240])).toEqual([
      [96, 156], [96, 240], [198, 240],
    ]);
  });

  it('spans the full spine from gate to exit', () => {
    expect(roadRoute([38, 90], [470, 240])).toEqual([
      [470, 90], [470, 156], [96, 156], [96, 240], [470, 240],
    ]);
  });

  it('exposes a spine whose consecutive segments are axis-aligned', () => {
    for (let i = 0; i < SPINE.length - 1; i++) {
      const [ax, ay] = SPINE[i], [bx, by] = SPINE[i + 1];
      expect(ax === bx || ay === by).toBe(true);
    }
  });
});

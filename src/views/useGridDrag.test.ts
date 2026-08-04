import { describe, expect, it } from 'vitest';
import { boxFromPointer, cellFromPoint, trackIndex, tracksOf, type Metrics } from './useGridDrag';

// The drag GESTURE is not tested here and cannot be: jsdom has no layout, so
// every rect is zero and a simulated pointer sequence would certify nothing.
// It is verified by hand on a mouse and on a touchscreen.
//
// What IS testable is the arithmetic between "the pointer is at these
// coordinates" and "the widget lands in this cell" — which is the half that
// actually gets written wrong.

const metrics = (cols: number[], rows: number[], gap = 10): Metrics => ({
  rect: { left: 100, top: 50 } as DOMRect,
  cols,
  rows,
  gapX: gap,
  gapY: gap,
});

describe('tracksOf', () => {
  it('reads the browser’s resolved track list', () => {
    expect(tracksOf('184px 184px 184px')).toEqual([184, 184, 184]);
    expect(tracksOf('190.5px 168px')).toEqual([190.5, 168]);
    // An element with no layout reports the SPECIFIED value instead of used
    // sizes. Nothing numeric to salvage, and a bogus number would be worse
    // than none.
    expect(tracksOf('repeat(6, minmax(0px, 1fr))')).toEqual([]);
  });
});

describe('trackIndex', () => {
  const tracks = [100, 100, 100];

  it('walks real track sizes, gaps included', () => {
    expect(trackIndex(tracks, 10, 0)).toBe(0);
    expect(trackIndex(tracks, 10, 99)).toBe(0);
    // The gap belongs to the track before it: 100–110 is still track 0's edge.
    expect(trackIndex(tracks, 10, 105)).toBe(0);
    expect(trackIndex(tracks, 10, 110)).toBe(1);
    expect(trackIndex(tracks, 10, 219)).toBe(1);
    expect(trackIndex(tracks, 10, 220)).toBe(2);
  });

  it('handles UNEVEN tracks, which is the whole reason it exists', () => {
    // A widget with tall content makes its row taller than its neighbours.
    // Dividing by a count would put the boundary at 150 and drift a whole row.
    const uneven = [250, 100, 100];
    expect(trackIndex(uneven, 10, 200)).toBe(0);
    expect(trackIndex(uneven, 10, 260)).toBe(1);
    expect(trackIndex(uneven, 10, 370)).toBe(2);
  });

  it('clamps at both ends rather than returning nonsense', () => {
    expect(trackIndex(tracks, 10, -50)).toBe(0);
    expect(trackIndex(tracks, 10, 99999)).toBe(2);
    expect(trackIndex([], 10, 40)).toBe(0);
  });
});

describe('cellFromPoint', () => {
  it('is relative to the grid, not the page', () => {
    const m = metrics([100, 100, 100], [100, 100]);
    expect(cellFromPoint(m, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(cellFromPoint(m, 320, 210)).toEqual({ x: 2, y: 1 });
  });
});

describe('boxFromPointer', () => {
  const m = metrics([100, 100, 100, 100, 100, 100], [100, 100, 100]);

  it('subtracts the grab offset in GRID UNITS', () => {
    // Grabbed by its bottom-right corner: without this the widget's top-left
    // teleports under the cursor and the whole thing jumps.
    expect(boxFromPointer(m, { x: 4, y: 2 }, { x: 1, y: 2 }, { w: 2, h: 3 })).toEqual({ x: 3, y: 0 });
    expect(boxFromPointer(m, { x: 2, y: 1 }, { x: 0, y: 0 }, { w: 2, h: 1 })).toEqual({ x: 2, y: 1 });
  });

  it('keeps the whole widget inside the columns', () => {
    // Aiming past the right edge parks it flush, rather than half off-grid.
    expect(boxFromPointer(m, { x: 5, y: 0 }, { x: 0, y: 0 }, { w: 2, h: 1 })).toEqual({ x: 4, y: 0 });
    expect(boxFromPointer(m, { x: 0, y: 0 }, { x: 3, y: 0 }, { w: 2, h: 1 })).toEqual({ x: 0, y: 0 });
  });

  it('does not clamp rows — a dashboard grows downward', () => {
    // Only the top is held; isFree() is what refuses a drop past a display's
    // bottom, because that limit belongs to the grid, not the pointer.
    expect(boxFromPointer(m, { x: 0, y: 9 }, { x: 0, y: 0 }, { w: 1, h: 1 })).toEqual({ x: 0, y: 9 });
    expect(boxFromPointer(m, { x: 0, y: 0 }, { x: 0, y: 4 }, { w: 1, h: 1 })).toEqual({ x: 0, y: 0 });
  });
});

// Grid geometry — pure integer arithmetic, no DB.
//
// THE SAME CASE TABLE RUNS IN src/lib/gridLayout.test.ts. gridLayout.js and
// gridLayout.ts are deliberate duplicates (server is JS, frontend is TS, no
// build step between them); these twinned tests are what keeps them honest.
// Change a case here, change it there.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GRID,
  MAX_ROWS_HARD,
  collisions,
  findFirstFit,
  fits,
  isFree,
  normalize,
  occupancy,
  overlaps,
  rowCount,
} from './gridLayout.js';

const box = (x, y, w = 1, h = 1) => ({ x, y, w, h });

test('overlaps: edge-touching is not overlapping', () => {
  // The classic off-by-one. A 2-wide widget at x=0 occupies columns 0 and 1,
  // so x=2 is its neighbour, not its collision.
  assert.equal(overlaps(box(0, 0, 2, 1), box(2, 0, 2, 1)), false, 'side by side');
  assert.equal(overlaps(box(0, 0, 1, 2), box(0, 2, 1, 2)), false, 'stacked');
  assert.equal(overlaps(box(0, 0, 2, 2), box(1, 1, 2, 2)), true, 'corner into corner');
  assert.equal(overlaps(box(0, 0, 6, 5), box(3, 2)), true, 'contained');
  assert.equal(overlaps(box(1, 1), box(1, 1)), true, 'identical');
});

test('fits: each boundary of each grid', () => {
  const dash = GRID.dashboard;
  assert.equal(fits(dash, box(4, 0, 2, 1)), true, 'flush against the right edge');
  assert.equal(fits(dash, box(5, 0, 2, 1)), false, 'one column over');
  assert.equal(fits(dash, box(0, MAX_ROWS_HARD - 1)), true, 'last allowed row');
  assert.equal(fits(dash, box(0, MAX_ROWS_HARD)), false, 'past the hard row ceiling');
  assert.equal(fits(dash, box(-1, 0)), false, 'negative x');
  assert.equal(fits(dash, box(0, 0, 0, 1)), false, 'zero width');

  const disp = GRID.display;
  assert.equal(fits(disp, box(0, 0, 3, 3)), true, 'a display filled by one widget');
  assert.equal(fits(disp, box(0, 0, 3, 4)), false, 'a display never scrolls');
  assert.equal(fits(disp, box(1, 0, 3, 1)), false, 'wider than three columns');
});

test('collisions names both widgets in a pair', () => {
  const a = { ...box(0, 0, 2, 2), type: 'loudness' };
  const b = { ...box(1, 1, 2, 2), type: 'countdown' };
  const c = { ...box(4, 0, 2, 1), type: 'viewers' };
  const pairs = collisions([a, b, c]);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].map((p) => p.type), ['loudness', 'countdown']);
  assert.deepEqual(collisions([a, c]), []);
});

test('occupancy skips the widget being dragged', () => {
  const placements = [{ id: 'w1', ...box(0, 0, 2, 2) }, { id: 'w2', ...box(2, 0) }];
  assert.equal(occupancy(placements).size, 5);
  assert.equal(occupancy(placements, 'w1').size, 1, 'its own cells are free to re-enter');
  assert.equal(isFree(GRID.dashboard, occupancy(placements, 'w1'), box(0, 0, 2, 2)), true);
  assert.equal(isFree(GRID.dashboard, occupancy(placements), box(0, 0, 2, 2)), false);
});

test('findFirstFit: empty grid, into a gap, and a full display', () => {
  const dash = GRID.dashboard;
  assert.deepEqual(findFirstFit(dash, [], { w: 2, h: 3 }), { x: 0, y: 0 });

  // Columns 0–1 and 3–4 taken on row 0: the 1-wide gap at column 2 is the
  // topmost-then-leftmost fit, ahead of the empty row below it.
  const withGap = [{ id: 'a', ...box(0, 0, 2, 1) }, { id: 'b', ...box(3, 0, 2, 1) }];
  assert.deepEqual(findFirstFit(dash, withGap, { w: 1, h: 1 }), { x: 2, y: 0 });
  // Too wide for the gap → the next row.
  assert.deepEqual(findFirstFit(dash, withGap, { w: 2, h: 1 }), { x: 0, y: 1 });

  // A dashboard always has room: it grows downward.
  const deep = Array.from({ length: 5 }, (_, y) => ({ id: `r${y}`, ...box(0, y, 6, 1) }));
  assert.deepEqual(findFirstFit(dash, deep, { w: 6, h: 1 }), { x: 0, y: 5 });

  // A display does not. `null` is the palette's "No room" signal.
  const full = [{ id: 'big', ...box(0, 0, 3, 3) }];
  assert.equal(findFirstFit(GRID.display, full, { w: 1, h: 1 }), null);
  assert.deepEqual(findFirstFit(GRID.display, [], { w: 3, h: 1 }), { x: 0, y: 0 });
});

test('rowCount grows a dashboard but never shrinks below its starting canvas', () => {
  const dash = GRID.dashboard;
  assert.equal(rowCount(dash, []), 5, 'an empty dashboard still looks like a canvas');
  assert.equal(rowCount(dash, [{ ...box(0, 0, 1, 2) }]), 5);
  assert.equal(rowCount(dash, [{ ...box(0, 5, 1, 3) }]), 8, 'deepest placement wins');
  assert.equal(rowCount(GRID.display, []), 3, 'a display is always exactly its grid');
  assert.equal(rowCount(GRID.display, [{ ...box(0, 0, 1, 1) }]), 3);
});

test('normalize orders by (y, x) — stored order is reading order', () => {
  const out = normalize([
    { type: 'c', ...box(3, 1) },
    { type: 'a', ...box(4, 0) },
    { type: 'b', ...box(0, 0) },
  ]);
  assert.deepEqual(out.map((p) => p.type), ['b', 'a', 'c']);
  assert.deepEqual(out.map((p) => p.position), [0, 1, 2]);
});

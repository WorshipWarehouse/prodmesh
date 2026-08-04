// Grid geometry for Views — the placement rules, with no storage and no DOM.
//
// ─────────────────────────────────────────────────────────────────────────────
//  THIS FILE IS DUPLICATED at src/lib/gridLayout.ts. Keep them in step.
//
//  The server is plain JS and the frontend is TypeScript, and there is no build
//  step between them (the Dockerfile copies server/ raw). The codebase already
//  answers this the same way: TILE_TYPES in validate.js duplicates
//  src/tiles/registry.tsx.
//
//  What makes the duplication safe is that the two copies are NOT peers. The
//  server is authoritative — it validates every save. The browser's copy exists
//  only to draw the drop shadow in the right place and grey out an impossible
//  drop. If they ever disagree, the failure is a save refused with a clear
//  message: annoying, not corrupting.
//
//  Both test files run the same case table, and each names the other.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The two canvases, as data rather than as branches on `kind`.
 *
 * A dashboard grows downward; a display is a hard 3×3 because it is a tile on
 * a video multiview and a scrollbar there is a fault, not a feature.
 */
export const GRID = {
  dashboard: { columns: 6, maxRows: null, defaultRows: 5 },
  display: { columns: 3, maxRows: 3 },
};

/**
 * A dashboard's rows are "unbounded" in the sense a user means it — the canvas
 * grows as you fill it. The server still needs a number, because `y` arrives
 * over HTTP and rendering 2^31 grid rows is a denial of service the browser
 * performs on itself. 6 × 24 = 144 cells is far past any real layout.
 */
export const MAX_ROWS_HARD = 24;

export const gridFor = (kind) => GRID[kind] ?? null;

/** Do two boxes share a cell? Edge-touching is NOT overlap. */
export function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** In bounds for this grid. Says nothing about neighbours. */
export function fits(grid, box) {
  if (box.x < 0 || box.y < 0 || box.w < 1 || box.h < 1) return false;
  if (box.x + box.w > grid.columns) return false;
  const limit = grid.maxRows ?? MAX_ROWS_HARD;
  return box.y + box.h <= limit;
}

/**
 * Every colliding pair.
 *
 * Pairwise rather than a bitmap because the validator has to NAME both widgets
 * in the error — "Loudness overlaps Countdown" is actionable and "invalid
 * layout" is not. n ≤ 40, so this is at most 780 comparisons.
 */
export function collisions(placements) {
  const pairs = [];
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      if (overlaps(placements[i], placements[j])) pairs.push([placements[i], placements[j]]);
    }
  }
  return pairs;
}

/**
 * Rows the content occupies.
 *
 * The deepest placement, NOT padded up to `defaultRows`: a live dashboard that
 * reserved five rows for one widget would be four rows of nothing on a wall.
 * `defaultRows` is the EDITOR's starting canvas — somewhere to drop into — and
 * that is the editor's business, not this function's.
 */
export function rowCount(grid, placements) {
  if (grid.maxRows != null) return grid.maxRows;
  return Math.max(1, placements.reduce((max, p) => Math.max(max, p.y + p.h), 0));
}

/**
 * Cell key → the id occupying it.
 *
 * A sparse Map rather than a 2D array because dashboard rows are unbounded:
 * allocating rows nobody has used is the wrong default when the whole point is
 * that the canvas grows. `ignoreId` lets the editor probe a candidate position
 * for the widget currently being dragged without colliding with itself.
 */
export function occupancy(placements, ignoreId = null) {
  const cells = new Map();
  for (const p of placements) {
    if (p.id === ignoreId) continue;
    for (let dy = 0; dy < p.h; dy += 1) {
      for (let dx = 0; dx < p.w; dx += 1) cells.set(`${p.x + dx},${p.y + dy}`, p.id);
    }
  }
  return cells;
}

/** Is this box in bounds AND clear of everything in `cells`? */
export function isFree(grid, cells, box) {
  if (!fits(grid, box)) return false;
  for (let dy = 0; dy < box.h; dy += 1) {
    for (let dx = 0; dx < box.w; dx += 1) {
      if (cells.has(`${box.x + dx},${box.y + dy}`)) return false;
    }
  }
  return true;
}

/**
 * Topmost-then-leftmost free box of this size, or null if there is nowhere.
 *
 * This is what the palette's Add button uses, and it is also what tells a
 * display's palette to grey a widget out: on a dashboard it always succeeds
 * (grow downward), on a full 3×3 it returns null, which IS the "No room"
 * signal.
 */
export function findFirstFit(grid, placements, size) {
  const cells = occupancy(placements);
  const limit = grid.maxRows ?? MAX_ROWS_HARD;
  for (let y = 0; y + size.h <= limit; y += 1) {
    for (let x = 0; x + size.w <= grid.columns; x += 1) {
      const box = { x, y, w: size.w, h: size.h };
      if (isFree(grid, cells, box)) return { x, y };
    }
  }
  return null;
}

/**
 * Sort by (y, x) and renumber `position`.
 *
 * Not cosmetic: it makes the stored order the READING order, which is what
 * lets a narrow screen fall back to a single column in a sensible sequence
 * with pure CSS and no JavaScript. A 2D canvas has no honest responsive story;
 * degrading to a priority order is at least truthful.
 */
export function normalize(placements) {
  return [...placements]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((p, position) => ({ ...p, position }));
}

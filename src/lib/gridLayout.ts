// Grid geometry for Views — the placement rules, with no storage and no DOM.
//
// ─────────────────────────────────────────────────────────────────────────────
//  THIS FILE IS DUPLICATED at server/gridLayout.js. Keep them in step.
//
//  The server is plain JS and this is TypeScript, and there is no build step
//  between them (the Dockerfile copies server/ raw). The codebase already
//  answers this the same way: TILE_TYPES in server/validate.js duplicates
//  src/tiles/registry.tsx.
//
//  What makes the duplication safe is that the two copies are NOT peers. The
//  server is authoritative — it validates every save. This copy exists only to
//  draw the drop shadow in the right place and grey out an impossible drop. If
//  they ever disagree, the failure is a save refused with a clear message:
//  annoying, not corrupting.
//
//  Both test files run the same case table, and each names the other.
// ─────────────────────────────────────────────────────────────────────────────

export type ViewKind = 'dashboard' | 'display';

export interface Grid {
  columns: number;
  /** null = grows downward. A number = a hard ceiling that must fit on screen. */
  maxRows: number | null;
  /** Rows an empty canvas still shows, so it looks like a canvas. */
  defaultRows?: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placement extends Box {
  id?: string;
  type: string;
  position?: number;
}

/**
 * The two canvases, as data rather than as branches on `kind`.
 *
 * A dashboard grows downward; a display is a hard 3×3 because it is a tile on
 * a video multiview and a scrollbar there is a fault, not a feature.
 */
export const GRID: Record<ViewKind, Grid> = {
  dashboard: { columns: 6, maxRows: null, defaultRows: 5 },
  display: { columns: 3, maxRows: 3 },
};

/**
 * A dashboard's rows are "unbounded" in the sense a user means it — the canvas
 * grows as you fill it. There is still a number, because `y` round-trips
 * through a database and rendering 2^31 grid rows is a denial of service the
 * browser performs on itself.
 */
export const MAX_ROWS_HARD = 24;

export const gridFor = (kind: string): Grid | null =>
  kind === 'dashboard' || kind === 'display' ? GRID[kind] : null;

/** Do two boxes share a cell? Edge-touching is NOT overlap. */
export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** In bounds for this grid. Says nothing about neighbours. */
export function fits(grid: Grid, box: Box): boolean {
  if (box.x < 0 || box.y < 0 || box.w < 1 || box.h < 1) return false;
  if (box.x + box.w > grid.columns) return false;
  return box.y + box.h <= (grid.maxRows ?? MAX_ROWS_HARD);
}

/**
 * Every colliding pair.
 *
 * Pairwise rather than a bitmap because the caller has to NAME both widgets in
 * the error — "Loudness overlaps Countdown" is actionable and "invalid layout"
 * is not. n ≤ 40, so this is at most 780 comparisons.
 */
export function collisions(placements: Placement[]): [Placement, Placement][] {
  const pairs: [Placement, Placement][] = [];
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      if (overlaps(placements[i], placements[j])) pairs.push([placements[i], placements[j]]);
    }
  }
  return pairs;
}

/** Rows the canvas must render: the deepest placement, but never less than the
 *  grid's starting height, so an empty dashboard still looks like a canvas. */
export function rowCount(grid: Grid, placements: Placement[]): number {
  if (grid.maxRows != null) return grid.maxRows;
  const deepest = placements.reduce((max, p) => Math.max(max, p.y + p.h), 0);
  return Math.max(deepest, grid.defaultRows ?? 1);
}

/**
 * Cell key → the id occupying it.
 *
 * A sparse Map rather than a 2D array because dashboard rows are unbounded:
 * allocating rows nobody has used is the wrong default when the whole point is
 * that the canvas grows. `ignoreId` lets the editor probe a candidate position
 * for the widget currently being dragged without colliding with itself.
 */
export function occupancy(placements: Placement[], ignoreId: string | null = null): Map<string, string> {
  const cells = new Map<string, string>();
  for (const p of placements) {
    if (p.id != null && p.id === ignoreId) continue;
    for (let dy = 0; dy < p.h; dy += 1) {
      for (let dx = 0; dx < p.w; dx += 1) cells.set(`${p.x + dx},${p.y + dy}`, p.id ?? p.type);
    }
  }
  return cells;
}

/** Is this box in bounds AND clear of everything in `cells`? */
export function isFree(grid: Grid, cells: Map<string, string>, box: Box): boolean {
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
export function findFirstFit(
  grid: Grid,
  placements: Placement[],
  size: { w: number; h: number },
): { x: number; y: number } | null {
  const cells = occupancy(placements);
  const limit = grid.maxRows ?? MAX_ROWS_HARD;
  for (let y = 0; y + size.h <= limit; y += 1) {
    for (let x = 0; x + size.w <= grid.columns; x += 1) {
      if (isFree(grid, cells, { x, y, w: size.w, h: size.h })) return { x, y };
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
export function normalize<T extends Placement>(placements: T[]): T[] {
  return [...placements]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((p, position) => ({ ...p, position }));
}

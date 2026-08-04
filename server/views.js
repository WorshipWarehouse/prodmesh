// ─────────────────────────────────────────────────────────────────────────────
//  VIEWS  —  a room's dashboards and displays.
//
//  A View is a grid of widget placements owned by a room:
//    kind 'dashboard' → interactive, 6 columns, rows grow downward
//    kind 'display'   → read-only, a hard 3×3, assigned to a station
//
//  A placement is {type, x, y, w, h, config} and nothing else, because a
//  widget takes {roomId, config} and nothing else (ADR 0010). That is what
//  makes a layout storable as data rather than as code.
//
//  READ NEVER DROPS A PLACEMENT. A view written by a newer build, or holding a
//  widget a later build removed, comes back verbatim and the browser holds the
//  slot with a placeholder card. Silently dropping the row would REFLOW the
//  grid — the arrangement someone made rearranges itself on a downgrade, which
//  is worse than one grey card. Writes are the opposite: validateView refuses
//  an unknown type, because a PUT comes from this build's own editor.
//  (Same asymmetry as the stream hub, which drops one bad topic rather than
//  failing the connection.)
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';

import { getDb } from './db.js';
import { gridFor } from './gridLayout.js';
import { validateView } from './validate.js';

const id = () => crypto.randomUUID();

const rowToView = (row, widgets) => ({
  id: row.id,
  roomId: row.room_id,
  kind: row.kind,
  name: row.name,
  slug: row.slug,
  columns: row.columns,
  maxRows: row.max_rows,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(widgets ? { widgets } : {}),
});

const rowToWidget = (row) => ({
  id: row.id,
  type: row.type,
  x: row.x,
  y: row.y,
  w: row.w,
  h: row.h,
  // Written by validateView, so it parses — but a hand-edited database
  // shouldn't take the whole view down with it.
  config: parseConfig(row.config),
});

function parseConfig(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function widgetsFor(viewId) {
  return getDb()
    .prepare('SELECT * FROM view_widgets WHERE view_id = ? ORDER BY position')
    .all(viewId)
    .map(rowToWidget);
}

/** A room's views, newest layout order, WITHOUT their placements. */
export function listViews(roomId) {
  return getDb()
    .prepare('SELECT * FROM views WHERE room_id = ? ORDER BY kind, position')
    .all(roomId)
    .map((row) => rowToView(row, null));
}

export function getView(viewId) {
  const row = getDb().prepare('SELECT * FROM views WHERE id = ?').get(viewId);
  return row ? rowToView(row, widgetsFor(row.id)) : null;
}

/**
 * Resolve the key in a URL. A station stores a view's UUID, but the URL a
 * human types into a kiosk is the slug — so both work, and renaming a view
 * never breaks a screen that was pointed at it.
 */
export function getViewByKey(roomId, key) {
  const row = getDb()
    .prepare('SELECT * FROM views WHERE room_id = ? AND (slug = ? OR id = ?)')
    .get(roomId, key, key);
  return row ? rowToView(row, widgetsFor(row.id)) : null;
}

/** Create an empty view. Throws on bad shape or a duplicate slug. */
export function createView({ roomId, kind, name, slug }, nowMs = Date.now()) {
  const clean = validateView({ kind, name, slug, widgets: [] });
  const db = getDb();
  if (db.prepare('SELECT 1 FROM views WHERE room_id = ? AND slug = ?').get(roomId, clean.slug)) {
    throw new Error(`This room already has a view called "${clean.slug}"`);
  }
  const next =
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM views WHERE room_id = ? AND kind = ?')
      .get(roomId, clean.kind).n;
  const viewId = id();
  db.prepare(
    `INSERT INTO views (id, room_id, kind, name, slug, columns, max_rows, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(viewId, roomId, clean.kind, clean.name, clean.slug, clean.columns, clean.maxRows, next, nowMs, nowMs);
  return getView(viewId);
}

/**
 * Replace a view's name, slug and placements in one transaction.
 *
 * Validate-then-replace, like appConfig.replaceChurch: a bad payload never
 * touches the database, and the return value is a fresh READ so the caller
 * sees exactly what was stored (normalised order included) rather than what it
 * sent.
 *
 * `kind` is fixed at creation — a display that became a dashboard would have
 * placements outside its own grid.
 */
export function replaceView(viewId, input, nowMs = Date.now()) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM views WHERE id = ?').get(viewId);
  if (!existing) throw new Error('Unknown view');

  const clean = validateView({ ...input, kind: existing.kind });
  const clash = db
    .prepare('SELECT 1 FROM views WHERE room_id = ? AND slug = ? AND id <> ?')
    .get(existing.room_id, clean.slug, viewId);
  if (clash) throw new Error(`This room already has a view called "${clean.slug}"`);

  db.transaction(() => {
    db.prepare('DELETE FROM view_widgets WHERE view_id = ?').run(viewId);
    const insert = db.prepare(
      `INSERT INTO view_widgets (id, view_id, type, x, y, w, h, config, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const w of clean.widgets) {
      insert.run(id(), viewId, w.type, w.x, w.y, w.w, w.h, JSON.stringify(w.config), w.position);
    }
    db.prepare('UPDATE views SET name = ?, slug = ?, updated_at = ? WHERE id = ?')
      .run(clean.name, clean.slug, nowMs, viewId);
  })();

  return getView(viewId);
}

/** Delete a view and its placements. Returns what was deleted, for the audit. */
export function deleteView(viewId) {
  const view = getView(viewId);
  if (!view) return null;
  const db = getDb();
  db.transaction(() => {
    // Explicit, NOT the ON DELETE CASCADE the schema declares: prodmesh never
    // issues PRAGMA foreign_keys, so that clause is documentation and these
    // rows would silently outlive the view.
    db.prepare('DELETE FROM view_widgets WHERE view_id = ?').run(viewId);
    db.prepare('DELETE FROM views WHERE id = ?').run(viewId);
  })();
  return view;
}

/** The grid a view is laid out on, as data both sides read. */
export const gridForView = (view) => ({
  columns: view.columns,
  maxRows: view.maxRows,
  defaultRows: gridFor(view.kind)?.defaultRows ?? null,
});

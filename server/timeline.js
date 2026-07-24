// ─────────────────────────────────────────────────────────────────────────────
//  SERVICE TIMELINE  —  records actual runtime of each order-of-service item.
//
//  As the Run of Show follows ProPresenter, each time the active item changes we
//  timestamp it. An item's actual duration = when the NEXT item became active.
//  Compared against the PC planned length, this powers the timing report used at
//  the post-service debrief.
//
//  Keyed per service instance (plan + service time), persisted to
//  server/data/timelines/ (git-ignored). recordActive() is synchronous and
//  dedupes by "last item", so multiple booth screens converge to one timeline
//  with no double-recording (Node is single-threaded — no interleave mid-call).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeJsonAtomic } from './atomicFile.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = join(process.env.PRODMESH_DATA_DIR ?? join(__dirname, 'data'), 'timelines');

const cache = new Map(); // instanceId -> timeline

const fileFor = (instanceId) => join(DIR, `${instanceId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);

function load(instanceId, ctx = {}) {
  if (cache.has(instanceId)) return cache.get(instanceId);
  let tl = null;
  const f = fileFor(instanceId);
  if (existsSync(f)) {
    try {
      tl = JSON.parse(readFileSync(f, 'utf8'));
    } catch {
      tl = null;
    }
  }
  if (!tl) tl = { instanceId, ...ctx, items: [] };
  cache.set(instanceId, tl);
  return tl;
}

function persist(instanceId, tl) {
  writeJsonAtomic(fileFor(instanceId), tl);
}

/**
 * Record that `entry` (an order-of-service item) is now the active item. Closes
 * out the previous item with its actual duration. No-op if it's the same item as
 * last (so slide-only changes don't append) or the item is null.
 *
 * entry = { itemId, itemName, itemIndex, plannedLength }
 */
export function recordActive(instanceId, ctx, entry, nowMs = Date.now()) {
  if (!entry?.itemId) return;
  const tl = load(instanceId, ctx);
  const items = tl.items;
  const last = items[items.length - 1];
  if (last && last.itemId === entry.itemId) return; // unchanged
  if (last && last.endedAt == null) {
    last.endedAt = nowMs;
    last.actualSeconds = Math.max(0, Math.round((nowMs - last.startedAt) / 1000));
  }
  items.push({
    itemId: entry.itemId,
    itemName: entry.itemName ?? '',
    itemIndex: entry.itemIndex ?? null,
    plannedLength: entry.plannedLength ?? null,
    startedAt: nowMs,
    endedAt: null,
    actualSeconds: null,
  });
  persist(instanceId, tl);
}

/**
 * Stamp display context (plan title, service type, time label…) onto a
 * timeline without touching its items — called at show start so the history
 * page can label past shows without re-querying Planning Center for old plans.
 * Only fills gaps; never overwrites values already recorded.
 */
export function ensure(instanceId, ctx) {
  const tl = load(instanceId, ctx);
  let changed = false;
  for (const [k, v] of Object.entries(ctx)) {
    if (v != null && tl[k] == null) {
      tl[k] = v;
      changed = true;
    }
  }
  if (changed) persist(instanceId, tl);
}

/** A timeline if one exists (cached or on disk) — never creates one. */
export function get(instanceId) {
  return cache.get(instanceId) ?? (existsSync(fileFor(instanceId)) ? load(instanceId) : null);
}

/** Every recorded timeline, for the history/analytics view. Reads from disk
 *  (cached live timelines are persisted on every change, so files are current). */
export function listAll() {
  if (!existsSync(DIR)) return [];
  const out = [];
  for (const f of readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(DIR, f), 'utf8')));
    } catch {
      /* skip corrupt file */
    }
  }
  return out;
}

/** Close out the last (open) item — called when a show ends. Creates the
 *  timeline if nothing was tracked, so ending always stamps completion. */
export function finalize(instanceId, nowMs = Date.now()) {
  const tl = load(instanceId);
  const last = tl.items[tl.items.length - 1];
  if (last && last.endedAt == null) {
    last.endedAt = nowMs;
    last.actualSeconds = Math.max(0, Math.round((nowMs - last.startedAt) / 1000));
  }
  tl.endedAt = nowMs;
  persist(instanceId, tl);
}

/** Erase a recorded timeline (accidental/invalid run). Irreversible. */
export function remove(instanceId) {
  cache.delete(instanceId);
  const f = fileFor(instanceId);
  if (existsSync(f)) unlinkSync(f);
}

/** Re-opening a show clears the completed stamp so state stays truthful. */
export function reopen(instanceId) {
  const f = fileFor(instanceId);
  const tl = cache.get(instanceId) ?? (existsSync(f) ? load(instanceId) : null);
  if (!tl || tl.endedAt == null) return;
  tl.endedAt = null;
  persist(instanceId, tl);
}

/** Build the planned-vs-actual report for a service instance. */
export function getReport(instanceId, nowMs = Date.now()) {
  const f = fileFor(instanceId);
  const tl = cache.get(instanceId) ?? (existsSync(f) ? load(instanceId) : null);
  if (!tl) return null;

  const items = tl.items.map((it) => {
    const ongoing = it.endedAt == null;
    const actual = it.actualSeconds != null ? it.actualSeconds : Math.max(0, Math.round((nowMs - it.startedAt) / 1000));
    const delta = it.plannedLength != null ? actual - it.plannedLength : null;
    return {
      itemName: it.itemName,
      plannedLength: it.plannedLength,
      actualSeconds: actual,
      delta,
      ongoing,
    };
  });
  const planned = items.reduce((s, i) => s + (i.plannedLength || 0), 0);
  const actual = items.reduce((s, i) => s + i.actualSeconds, 0);
  return {
    instanceId,
    serviceLabel: tl.serviceLabel ?? null,
    startedAt: tl.items[0]?.startedAt ?? null,
    completedAt: tl.endedAt ?? null,
    items,
    totals: { planned, actual, delta: actual - planned },
  };
}

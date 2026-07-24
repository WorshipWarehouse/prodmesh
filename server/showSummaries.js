// ─────────────────────────────────────────────────────────────────────────────
//  SHOW SUMMARIES  —  one SQLite row per recorded show.
//
//  The Analytics history view used to re-read and re-parse every timeline JSON
//  file (twice) and full-scan spl_samples per show on every request. A summary
//  row is written when a show ends, kept fresh while one is live, and
//  backfilled once per boot for timelines recorded before this table existed —
//  so history becomes a single indexed query.
//
//  The per-item timeline JSON stays the source of truth for the detailed
//  report; a summary can always be rebuilt from it (refresh() does exactly
//  that). Room name/site and SPL target/limit are NOT stored here — they're
//  applied at read time so history tracks current room settings.
// ─────────────────────────────────────────────────────────────────────────────

import { getDb } from './db.js';
import * as timeline from './timeline.js';
import * as splStore from './splStore.js';

const UPSERT = `
  INSERT INTO show_summaries (
    instance_id, room_id, plan_id, time_id, plan_title, service_type_name,
    dates, time_name, time_starts_at, started_at, completed_at,
    item_count, planned_seconds, actual_seconds, spl, updated_at
  ) VALUES (
    @instanceId, @roomId, @planId, @timeId, @planTitle, @serviceTypeName,
    @dates, @timeName, @timeStartsAt, @startedAt, @completedAt,
    @itemCount, @plannedSeconds, @actualSeconds, @spl, @updatedAt
  )
  ON CONFLICT (instance_id) DO UPDATE SET
    room_id = excluded.room_id, plan_id = excluded.plan_id,
    time_id = excluded.time_id, plan_title = excluded.plan_title,
    service_type_name = excluded.service_type_name, dates = excluded.dates,
    time_name = excluded.time_name, time_starts_at = excluded.time_starts_at,
    started_at = excluded.started_at, completed_at = excluded.completed_at,
    item_count = excluded.item_count, planned_seconds = excluded.planned_seconds,
    actual_seconds = excluded.actual_seconds, spl = excluded.spl,
    updated_at = excluded.updated_at
`;

/** Rebuild a show's summary row from its timeline (+ SPL samples). */
export function refresh(instanceId) {
  const tl = timeline.get(instanceId);
  if (!tl) return null;
  const planned = tl.items.reduce((s, i) => s + (i.plannedLength || 0), 0);
  const actual = tl.items.reduce((s, i) => s + (i.actualSeconds || 0), 0);
  // Keep an already-captured SPL block if the raw samples have been pruned.
  const agg = splStore.aggregate(instanceId) ?? get(instanceId)?.spl ?? null;
  getDb().prepare(UPSERT).run({
    instanceId,
    roomId: tl.roomId ?? null,
    planId: tl.planId ?? null,
    timeId: tl.timeId ?? null,
    planTitle: tl.planTitle ?? null,
    serviceTypeName: tl.serviceTypeName ?? null,
    dates: tl.dates ?? null,
    timeName: tl.timeName ?? null,
    timeStartsAt: tl.timeStartsAt ?? null,
    startedAt: tl.items[0]?.startedAt ?? null,
    completedAt: tl.endedAt ?? null,
    itemCount: tl.items.length,
    plannedSeconds: planned,
    actualSeconds: actual,
    spl: agg ? JSON.stringify(agg) : null,
    updatedAt: Date.now(),
  });
  return get(instanceId);
}

const rowToSummary = (r) => ({
  instanceId: r.instance_id,
  roomId: r.room_id,
  planId: r.plan_id,
  timeId: r.time_id,
  planTitle: r.plan_title,
  serviceTypeName: r.service_type_name,
  dates: r.dates,
  timeName: r.time_name,
  timeStartsAt: r.time_starts_at,
  startedAt: r.started_at,
  completedAt: r.completed_at,
  itemCount: r.item_count,
  plannedSeconds: r.planned_seconds,
  actualSeconds: r.actual_seconds,
  spl: r.spl ? JSON.parse(r.spl) : null,
});

export function get(instanceId) {
  const r = getDb()
    .prepare('SELECT * FROM show_summaries WHERE instance_id = ?')
    .get(instanceId);
  return r ? rowToSummary(r) : null;
}

/** All summaries, newest first (unstarted rows sort oldest, like before). */
export function listAll() {
  return getDb()
    .prepare('SELECT * FROM show_summaries ORDER BY COALESCE(started_at, 0) DESC')
    .all()
    .map(rowToSummary);
}

// Timelines recorded before this table existed (or on a restored data dir)
// have no summary row yet. One pass per boot builds the missing ones.
let synced = false;
export function syncFromTimelines() {
  if (synced) return;
  synced = true;
  const have = new Set(
    getDb().prepare('SELECT instance_id FROM show_summaries').all().map((r) => r.instance_id),
  );
  let built = 0;
  for (const tl of timeline.listAll()) {
    if (tl.instanceId && !have.has(tl.instanceId)) {
      refresh(tl.instanceId);
      built += 1;
    }
  }
  if (built) console.log(`[summaries] backfilled ${built} show summaries from timelines`);
}

/** Erase a summary row (deleting a recorded show). */
export function remove(instanceId) {
  getDb().prepare('DELETE FROM show_summaries WHERE instance_id = ?').run(instanceId);
}

/** Test hook: allow syncFromTimelines to run again. */
export function resetSyncFlag() {
  synced = false;
}

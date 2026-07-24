// ─────────────────────────────────────────────────────────────────────────────
//  SPL STORE  —  loudness samples captured while a show is live.
//
//  ~1 sample/second for a 75-minute service ≈ 4,500 rows per room — exactly
//  the data shape JSON-file rewrites are wrong for and SQLite is built for.
//  Keyed by the same instanceId (planId__timeId) as the timing timeline so
//  the Show Report can join the two.
// ─────────────────────────────────────────────────────────────────────────────

import { getDb } from './db.js';

export function record(roomId, instanceId, ts, spl, ca = null) {
  getDb()
    .prepare('INSERT INTO spl_samples (room_id, instance_id, ts, spl, ca) VALUES (?, ?, ?, ?, ?)')
    .run(roomId, instanceId, ts, spl, ca);
}

// Average loudness is an energy average (Leq), not an arithmetic mean:
// 10·log10( mean( 10^(L/10) ) ). A minute at 95 dB moves it far more than a
// minute at 80 dB — which is what pastors/elders actually care about.
export function leq(values) {
  if (!values.length) return null;
  const mean = values.reduce((s, v) => s + 10 ** (v / 10), 0) / values.length;
  return 10 * Math.log10(mean);
}

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/**
 * Aggregate a service instance's samples → { count, leq, peak, from, to, ca }.
 * ca (when the analysis source captured it) = { avg, max } — a plain mean,
 * not Leq: C-A is already a level *difference*, so energy math doesn't apply.
 */
export function aggregate(instanceId) {
  const rows = getDb()
    .prepare('SELECT ts, spl, ca FROM spl_samples WHERE instance_id = ? ORDER BY ts')
    .all(instanceId);
  if (rows.length === 0) return null;
  const values = rows.map((r) => r.spl);
  const cas = rows.map((r) => r.ca).filter((v) => v != null);
  return {
    count: rows.length,
    leq: round1(leq(values)),
    peak: round1(Math.max(...values)),
    from: rows[0].ts,
    to: rows[rows.length - 1].ts,
    ca: cas.length
      ? { avg: round1(cas.reduce((s, v) => s + v, 0) / cas.length), max: round1(Math.max(...cas)) }
      : null,
  };
}

/** Running stats seed for a (re)starting show — continues where it left off. */
export function runningStats(instanceId) {
  const rows = getDb()
    .prepare('SELECT spl, ca FROM spl_samples WHERE instance_id = ?')
    .all(instanceId);
  const cas = rows.map((r) => r.ca).filter((v) => v != null);
  return {
    n: rows.length,
    sumEnergy: rows.reduce((s, r) => s + 10 ** (r.spl / 10), 0),
    peak: rows.length ? Math.max(...rows.map((r) => r.spl)) : null,
    caN: cas.length,
    caSum: cas.reduce((s, v) => s + v, 0),
    caMax: cas.length ? Math.max(...cas) : null,
  };
}

/** Erase one instance's samples (deleting a recorded show). */
export function removeInstance(instanceId) {
  return getDb().prepare('DELETE FROM spl_samples WHERE instance_id = ?').run(instanceId).changes;
}

// ── Retention ─────────────────────────────────────────────────────────────────
// Raw samples only serve the detailed report and reopen-seeding; the show's
// aggregate (leq/peak/ca) survives in show_summaries. Prune samples older than
// PRODMESH_SPL_RETENTION_DAYS (default 90; 0 or negative disables).

export function prune(days = Number(process.env.PRODMESH_SPL_RETENTION_DAYS ?? 90)) {
  if (!Number.isFinite(days) || days <= 0) return 0;
  const cutoff = Date.now() - days * 86_400_000;
  const { changes } = getDb().prepare('DELETE FROM spl_samples WHERE ts < ?').run(cutoff);
  if (changes) console.log(`[spl] pruned ${changes} samples older than ${days} days`);
  return changes;
}

/** Prune now and then daily — the Producer runs for weeks between restarts. */
export function startRetention() {
  prune();
  const t = setInterval(prune, 86_400_000);
  t.unref?.();
  return t;
}

export { round1 };

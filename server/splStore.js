// ─────────────────────────────────────────────────────────────────────────────
//  SPL STORE  —  loudness samples captured while a show is live.
//
//  ~1 sample/second for a 75-minute service ≈ 4,500 rows per room — exactly
//  the data shape JSON-file rewrites are wrong for and SQLite is built for.
//  Keyed by the same instanceId (planId__timeId) as the timing timeline so
//  the Show Report can join the two.
// ─────────────────────────────────────────────────────────────────────────────

import { getDb } from './db.js';

export function record(roomId, instanceId, ts, spl) {
  getDb()
    .prepare('INSERT INTO spl_samples (room_id, instance_id, ts, spl) VALUES (?, ?, ?, ?)')
    .run(roomId, instanceId, ts, spl);
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

/** Aggregate a service instance's samples → { count, leq, peak, from, to }. */
export function aggregate(instanceId) {
  const rows = getDb()
    .prepare('SELECT ts, spl FROM spl_samples WHERE instance_id = ? ORDER BY ts')
    .all(instanceId);
  if (rows.length === 0) return null;
  const values = rows.map((r) => r.spl);
  return {
    count: rows.length,
    leq: round1(leq(values)),
    peak: round1(Math.max(...values)),
    from: rows[0].ts,
    to: rows[rows.length - 1].ts,
  };
}

/** Running stats seed for a (re)starting show — continues where it left off. */
export function runningStats(instanceId) {
  const rows = getDb()
    .prepare('SELECT spl FROM spl_samples WHERE instance_id = ?')
    .all(instanceId);
  return {
    n: rows.length,
    sumEnergy: rows.reduce((s, r) => s + 10 ** (r.spl / 10), 0),
    peak: rows.length ? Math.max(...rows.map((r) => r.spl)) : null,
  };
}

export { round1 };

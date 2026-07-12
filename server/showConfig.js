// ─────────────────────────────────────────────────────────────────────────────
//  SHOW CONFIG  —  per-event automation settings (Event Detail → Show Config).
//
//  config = {
//    startItemId: '<pc item id>' | null,  // PP lands on this item → show starts
//    endItemId:   '<pc item id>' | null,  // last slide of this item → show ends
//    map: { '<pc item id>': { ppIndex, ppName } }  // manual PC→PP overrides
//  }
//
//  Keyed per (roomId, planId) — per EVENT, not per service time: the 9:00 and
//  11:00 share one config, autostart picks the right time by the clock.
// ─────────────────────────────────────────────────────────────────────────────

import { getDb } from './db.js';

export function getConfig(roomId, planId) {
  const row = getDb()
    .prepare('SELECT config FROM show_config WHERE room_id = ? AND plan_id = ?')
    .get(roomId, planId);
  if (!row) return null;
  try {
    return JSON.parse(row.config);
  } catch {
    return null;
  }
}

/** Validate + save. Throws on bad shape — callers map that to HTTP 400. */
export function setConfig(roomId, planId, config, nowMs = Date.now()) {
  const clean = validate(config);
  getDb()
    .prepare(
      `INSERT INTO show_config (room_id, plan_id, config, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (room_id, plan_id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`,
    )
    .run(roomId, planId, JSON.stringify(clean), nowMs);
  return clean;
}

export function clearConfig(roomId, planId) {
  getDb().prepare('DELETE FROM show_config WHERE room_id = ? AND plan_id = ?').run(roomId, planId);
}

function validate(config) {
  if (config == null || typeof config !== 'object') throw new Error('config must be an object');
  const id = (v, name) => {
    if (v == null || v === '') return null;
    if (typeof v !== 'string') throw new Error(`${name} must be an item id`);
    return v;
  };
  const map = {};
  if (config.map != null) {
    if (typeof config.map !== 'object') throw new Error('map must be an object');
    for (const [pcId, pp] of Object.entries(config.map)) {
      if (pp == null) continue; // "Auto" — no override
      if (!Number.isInteger(pp.ppIndex) || pp.ppIndex < 0) {
        throw new Error('map values need an integer ppIndex');
      }
      map[pcId] = { ppIndex: pp.ppIndex, ppName: typeof pp.ppName === 'string' ? pp.ppName : null };
    }
  }
  return {
    startItemId: id(config.startItemId, 'startItemId'),
    endItemId: id(config.endItemId, 'endItemId'),
    map,
  };
}

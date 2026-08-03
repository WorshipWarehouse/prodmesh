// ─────────────────────────────────────────────────────────────────────────────
//  SHOW CONFIG  —  per-event automation settings (Event Detail → Show Config).
//
//  config = {
//    startItemId: '<pc item id>' | null,  // PP lands on this item → show starts
//    endItemId:   '<pc item id>' | null,  // last slide of this item → show ends
//    map: { '<pc item id>': { ppIndex, ppName } }  // manual PC→PP overrides
//    videos: { '<time id>': '<youtube video id>' }  // pinned broadcast per service
//  }
//
//  Keyed per (roomId, planId) — per EVENT, not per service time: the 9:00 and
//  11:00 share one config, autostart picks the right time by the clock.
//
//  `videos` is the exception, and deliberately so: a channel pre-creates one
//  broadcast per service, so 8:00 and 9:30 are DIFFERENT videos on the same
//  plan. It lives here rather than on the room for exactly that reason — a
//  room-level pin would attribute both services to one broadcast and report
//  the same numbers twice. Normally nothing needs pinning at all: the watcher
//  finds whatever is live on the channel, which is already right per service.
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
  // Pinned broadcasts per service time. Charset-checked because the value is
  // interpolated into a YouTube request URL (same reasoning as validateHost).
  const videos = {};
  if (config.videos != null) {
    if (typeof config.videos !== 'object') throw new Error('videos must be an object');
    for (const [timeId, videoId] of Object.entries(config.videos)) {
      if (videoId == null || videoId === '') continue; // "Auto" — find what's live
      if (typeof videoId !== 'string' || videoId.length > 32 || !/^[A-Za-z0-9_-]+$/.test(videoId)) {
        throw new Error(`"${timeId}" needs a YouTube video id (letters, digits, - and _ only)`);
      }
      videos[timeId] = videoId;
    }
  }

  return {
    startItemId: id(config.startItemId, 'startItemId'),
    endItemId: id(config.endItemId, 'endItemId'),
    map,
    videos,
  };
}

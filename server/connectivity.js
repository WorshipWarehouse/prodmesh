// ─────────────────────────────────────────────────────────────────────────────
//  ROOM CONNECTIVITY  —  per-room integration config migrating out of
//  rooms.config.js and into SQLite (ADR 0009), one integration at a time.
//
//  Migrated so far:
//    planningCenter — which PC service types feed the room
//    analysis       — SPL source (Smaart or ProdMesh Remote RTA) + dB goals
//
//  On first boot each integration seeds from what rooms.config.js declares;
//  after that the database owns it and the file entry is only a fresh-install
//  seed. Seeding is per-integration, so deployments that predate a migration
//  adopt their file config the first time they boot with it.
//
//  Live propagation: every consumer (event endpoints, show manager, autostart)
//  reads `room.<integration>` off the shared in-memory rooms map, so
//  applyConnectivity() assigns the stored values onto those room objects —
//  edits take effect immediately, no restart, no consumer changes. SPL
//  watchers pick up an edit on their next reconnect cycle.
// ─────────────────────────────────────────────────────────────────────────────
import { getDb } from './db.js';
import { rooms } from './rooms.config.js';
import { SOURCES } from './integrations/analysis.js';

const PC = 'planningCenter';
const ANALYSIS = 'analysis';
const INTEGRATIONS = [PC, ANALYSIS];

export function validateServiceTypes(input) {
  if (!Array.isArray(input)) throw new Error('serviceTypes must be an array');
  if (input.length > 10) throw new Error('Too many service types (max 10)');
  const seen = new Set();
  return input.map((st) => {
    const id = String(st?.id ?? '').trim();
    const name = String(st?.name ?? '').trim();
    if (!/^\d{1,12}$/.test(id)) throw new Error(`Service type id "${id}" must be numeric (from Planning Center)`);
    if (seen.has(id)) throw new Error(`Duplicate service type id "${id}"`);
    seen.add(id);
    if (!name || name.length > 60) throw new Error('Each service type needs a name (max 60 characters)');
    return { id, name };
  });
}

// Normalize + validate an analysis config; null clears it (no analyzer).
// `mock` is deliberately not settable here — it's a dev-room fixture that
// only rooms.config.js declares (and the seed preserves).
export function validateAnalysis(input) {
  if (input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('analysis must be an object');
  const source = String(input.source ?? 'smaart');
  if (!SOURCES.includes(source)) throw new Error(`Unknown analysis source "${source}"`);
  const host = String(input.host ?? '').trim();
  if (!host || host.length > 100) throw new Error('Analysis source needs a host (max 100 characters)');
  const out = { source, host };
  const port = input.port === '' || input.port == null ? null : Number(input.port);
  if (port != null) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be 1–65535');
    out.port = port;
  }
  for (const key of ['target', 'limit']) {
    const v = input[key] === '' || input[key] == null ? null : Number(input[key]);
    if (v == null) continue;
    if (!Number.isFinite(v) || v < 40 || v > 130) throw new Error(`${key} must be 40–130 dB`);
    out[key] = v;
  }
  if (out.target != null && out.limit != null && out.limit < out.target) {
    throw new Error('limit must be at or above target');
  }
  const metric = String(input.metric ?? '').trim();
  if (metric) {
    if (metric.length > 60) throw new Error('metric must be at most 60 characters');
    out.metric = metric;
  }
  if (source === 'smaart') {
    const password = String(input.password ?? '');
    if (password) {
      if (password.length > 100) throw new Error('password must be at most 100 characters');
      out.password = password;
    }
  }
  return out;
}

function readRow(roomId, integration) {
  const row = getDb().prepare(
    'SELECT config FROM room_connectivity WHERE room_id = ? AND integration = ?',
  ).get(roomId, integration);
  return row ? JSON.parse(row.config) : null;
}

function writeRow(roomId, integration, config) {
  getDb().prepare(
    `INSERT INTO room_connectivity (room_id, integration, config, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(room_id, integration) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`,
  ).run(roomId, integration, JSON.stringify(config), Date.now());
}

function deleteRow(roomId, integration) {
  getDb().prepare('DELETE FROM room_connectivity WHERE room_id = ? AND integration = ?')
    .run(roomId, integration);
}

/** The stored Planning Center config for a room (null if the room has none). */
export function getPlanningCenter(roomId) {
  return readRow(roomId, PC);
}

/** Validate + store a room's service types, then apply them live. */
export function setPlanningCenter(roomId, serviceTypes) {
  if (!rooms[roomId]) throw new Error(`Unknown room "${roomId}"`);
  const clean = { serviceTypes: validateServiceTypes(serviceTypes) };
  writeRow(roomId, PC, clean);
  applyConnectivity();
  return clean;
}

/** The stored analysis-source config for a room (null if the room has none). */
export function getAnalysis(roomId) {
  return readRow(roomId, ANALYSIS);
}

/** Validate + store a room's analysis source (null clears it), apply live. */
export function setAnalysis(roomId, config) {
  if (!rooms[roomId]) throw new Error(`Unknown room "${roomId}"`);
  const clean = validateAnalysis(config);
  if (clean === null) deleteRow(roomId, ANALYSIS);
  else writeRow(roomId, ANALYSIS, clean);
  applyConnectivity();
  return clean;
}

/**
 * Assign stored connectivity onto the live rooms map (boot + after saves).
 * Once an integration has been seeded the database is authoritative: a room
 * with no row has that integration cleared, even if rooms.config.js still
 * declares one (the file entry is only a fresh-install seed).
 */
export function applyConnectivity() {
  const marker = getDb().prepare('SELECT value FROM app_config WHERE key = ?');
  for (const integration of INTEGRATIONS) {
    const seeded = Boolean(marker.get(`connectivity_seeded:${integration}`));
    for (const room of Object.values(rooms)) {
      const stored = readRow(room.id, integration);
      if (stored) room[integration] = stored;
      else if (seeded) delete room[integration];
    }
  }
}

// First boot with each integration: adopt what rooms.config.js declares so
// behavior doesn't change, then let the database own it. A marker (not a row
// count) records that seeding ran, so clearing every row of an integration
// doesn't resurrect the file config on the next boot. Databases seeded before
// markers existed just gain the marker.
function seedIfEmpty() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) AS n FROM room_connectivity WHERE integration = ?');
  const marker = db.prepare('SELECT value FROM app_config WHERE key = ?');
  const setMarker = db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)');
  const seeders = {
    [PC]: (room) =>
      room.planningCenter?.serviceTypes?.length
        ? { serviceTypes: room.planningCenter.serviceTypes }
        : null,
    [ANALYSIS]: (room) => room.analysis ?? null,
  };
  for (const integration of INTEGRATIONS) {
    const key = `connectivity_seeded:${integration}`;
    if (marker.get(key)) continue;
    if (count.get(integration).n === 0) {
      for (const room of Object.values(rooms)) {
        const cfg = seeders[integration](room);
        if (cfg) writeRow(room.id, integration, cfg);
      }
    }
    setMarker.run(key, '1');
  }
}

seedIfEmpty();
applyConnectivity();

// ─────────────────────────────────────────────────────────────────────────────
//  ROOM CONNECTIVITY  —  per-room integration config migrating out of
//  rooms.config.js and into SQLite (ADR 0009), one integration at a time.
//
//  First migrated integration: Planning Center service types. On first boot
//  each room's serviceTypes are seeded from rooms.config.js; after that the
//  database owns them and the file entry is only a fresh-install seed.
//
//  Live propagation: every consumer (event endpoints, show manager, autostart)
//  reads `room.planningCenter` off the shared in-memory rooms map, so
//  applyConnectivity() assigns the stored values onto those room objects —
//  edits take effect immediately, no restart, no consumer changes.
// ─────────────────────────────────────────────────────────────────────────────
import { getDb } from './db.js';
import { rooms } from './rooms.config.js';

const PC = 'planningCenter';

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

/** Assign stored connectivity onto the live rooms map (boot + after saves). */
export function applyConnectivity() {
  for (const room of Object.values(rooms)) {
    const stored = readRow(room.id, PC);
    if (stored) room.planningCenter = stored;
  }
}

// First boot (or first boot after this feature): adopt what rooms.config.js
// declares so behavior doesn't change, then let the database own it.
function seedIfEmpty() {
  const count = getDb().prepare('SELECT COUNT(*) AS n FROM room_connectivity WHERE integration = ?').get(PC).n;
  if (count > 0) return;
  for (const room of Object.values(rooms)) {
    if (room.planningCenter?.serviceTypes?.length) {
      writeRow(room.id, PC, { serviceTypes: room.planningCenter.serviceTypes });
    }
  }
}

seedIfEmpty();
applyConnectivity();

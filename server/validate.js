// Startup validation for the structural room config. Throws a clear, actionable
// error instead of letting a typo surface as a cryptic runtime failure later.

function fail(msg) {
  throw new Error(`Invalid rooms.config.js: ${msg}`);
}

/** Validate the `rooms` map. Returns the rooms on success; throws otherwise. */
export function validateRooms(rooms) {
  if (!rooms || typeof rooms !== 'object') fail('`rooms` must be an object.');

  for (const [key, room] of Object.entries(rooms)) {
    const where = `room "${key}"`;
    if (!room.id) fail(`${where} is missing an id.`);
    if (room.id !== key) fail(`${where} id "${room.id}" must match its key "${key}".`);
    if (!room.name) fail(`${where} is missing a name.`);
    if (!Array.isArray(room.modes) || room.modes.length === 0) {
      fail(`${where} must have a non-empty modes array.`);
    }

    if (!room.mock) {
      if (!room.companion?.host) fail(`${where} is live (mock:false) but has no companion.host.`);
      if (!room.state?.variable) fail(`${where} is live but has no state.variable.`);
    }

    const ids = new Set();
    for (const m of room.modes) {
      const mwhere = `${where} mode "${m.id ?? '?'}"`;
      if (!m.id) fail(`${mwhere} is missing an id.`);
      if (ids.has(m.id)) fail(`${where} has duplicate mode id "${m.id}".`);
      ids.add(m.id);
      if (!m.label) fail(`${mwhere} is missing a label.`);
      if (!m.match) fail(`${mwhere} is missing a match value.`);
      const p = m.press;
      if (p) {
        for (const f of ['page', 'row', 'column']) {
          if (!Number.isInteger(p[f])) fail(`${mwhere} press.${f} must be an integer.`);
        }
      }
    }
  }
  return rooms;
}

/** Validate a schedules object (used when saving from the Settings UI). */
export function validateSchedules(schedules) {
  if (schedules == null) return {};
  if (typeof schedules !== 'object') throw new Error('schedules must be an object');
  for (const windows of Object.values(schedules)) {
    if (!Array.isArray(windows)) throw new Error('each room schedule must be an array');
    for (const w of windows) {
      if (!Array.isArray(w.days) || w.days.some((d) => d < 0 || d > 6)) {
        throw new Error('window.days must be integers 0-6');
      }
      if (!/^\d{1,2}:\d{2}$/.test(String(w.start)) || !/^\d{1,2}:\d{2}$/.test(String(w.end))) {
        throw new Error('window.start/end must be "HH:MM"');
      }
      if (!Array.isArray(w.lock)) throw new Error('window.lock must be an array');
    }
  }
  return schedules;
}

/** Validate one checklist template's items (saving from the Admin editor). */
export function validateTemplateItems(items) {
  if (!Array.isArray(items)) throw new Error('items must be an array');
  if (items.length > 50) throw new Error('a checklist can have at most 50 items');
  for (const it of items) {
    if (typeof it?.label !== 'string' || !it.label.trim()) {
      throw new Error('every item needs a label');
    }
    if (it.label.length > 200) throw new Error('item labels must be ≤ 200 characters');
    if (it.id != null && !/^[a-z0-9_-]{1,60}$/i.test(it.id)) {
      throw new Error('item ids may only contain letters, digits, - and _');
    }
    if (it.action != null) {
      if (it.action.type !== 'mode' || typeof it.action.mode !== 'string' || !it.action.mode) {
        throw new Error('item action must be { type: "mode", mode: "<mode id>" }');
      }
    }
  }
  return items;
}

// ── Institution topology (sites / rooms / Quick Access tiles) ────────────────
// Validates the whole tree the Admin → Campuses editor saves. Returns a
// normalized copy (trimmed strings, only known fields) so junk never persists.

const TOPO_ID = /^[a-z0-9][a-z0-9-]{0,59}$/;
const TILE_TYPES = new Set(['companion', 'screenshare', 'link', 'route', 'placeholder']);
const COMPANION_VIEWS = new Set(['admin', 'tablet', 'emulator']);

export function validateChurch(input) {
  if (!input || typeof input !== 'object') throw new Error('config must be an object');
  const name = String(input.name ?? '').trim();
  if (!name || name.length > 80) throw new Error('Institution name must be 1–80 characters');
  if (!Array.isArray(input.sites) || input.sites.length === 0) throw new Error('At least one site is required');
  if (input.sites.length > 20) throw new Error('Too many sites (max 20)');

  const seen = new Set();
  const claim = (id, what) => {
    if (typeof id !== 'string' || !TOPO_ID.test(id)) {
      throw new Error(`${what} id "${id}" must be lowercase letters, numbers, and dashes`);
    }
    if (seen.has(id)) throw new Error(`Duplicate id "${id}"`);
    seen.add(id);
    return id;
  };
  const text = (value, what, max, { required = false } = {}) => {
    const s = String(value ?? '').trim();
    if (required && !s) throw new Error(`${what} is required`);
    if (s.length > max) throw new Error(`${what} must be at most ${max} characters`);
    return s || undefined;
  };

  const sites = input.sites.map((site) => {
    const id = claim(site?.id, 'Site');
    if (site.status !== 'active' && site.status !== 'coming-soon') {
      throw new Error(`Site "${id}" status must be active or coming-soon`);
    }
    const auditoriums = Array.isArray(site.auditoriums) ? site.auditoriums : [];
    if (auditoriums.length > 20) throw new Error(`Site "${id}" has too many rooms (max 20)`);
    return {
      id,
      name: text(site.name, `Site "${id}" name`, 60, { required: true }),
      status: site.status,
      note: text(site.note, `Site "${id}" note`, 120),
      auditoriums: auditoriums.map((room) => {
        const roomId = claim(room?.id, 'Room');
        const tiles = Array.isArray(room.tiles) ? room.tiles : [];
        if (tiles.length > 40) throw new Error(`Room "${roomId}" has too many tiles (max 40)`);
        return {
          id: roomId,
          name: text(room.name, `Room "${roomId}" name`, 60, { required: true }),
          tiles: tiles.map((tile) => validateTile(tile, claim, text)),
        };
      }),
    };
  });

  return { name, sites };
}

function validateTile(tile, claim, text) {
  const id = claim(tile?.id, 'Tile');
  if (!TILE_TYPES.has(tile.type)) throw new Error(`Tile "${id}" has unknown type "${tile.type}"`);
  const base = {
    id,
    type: tile.type,
    label: text(tile.label, `Tile "${id}" label`, 60, { required: true }),
    note: text(tile.note, `Tile "${id}" note`, 120),
    icon: text(tile.icon, `Tile "${id}" icon`, 8),
  };
  switch (tile.type) {
    case 'companion': {
      const out = { ...base, host: text(tile.host, `Tile "${id}" host`, 120, { required: true }) };
      if (tile.port != null && tile.port !== '') {
        const port = Number(tile.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Tile "${id}" port must be 1–65535`);
        out.port = port;
      }
      if (tile.view != null && tile.view !== '') {
        if (!COMPANION_VIEWS.has(tile.view)) throw new Error(`Tile "${id}" view must be admin, tablet, or emulator`);
        out.view = tile.view;
      }
      return out;
    }
    case 'screenshare':
      return {
        ...base,
        host: text(tile.host, `Tile "${id}" host`, 120, { required: true }),
        username: text(tile.username, `Tile "${id}" username`, 60),
      };
    case 'link': {
      const url = text(tile.url, `Tile "${id}" url`, 300, { required: true });
      if (!/^https?:\/\//.test(url)) throw new Error(`Tile "${id}" url must start with http:// or https://`);
      return { ...base, url };
    }
    case 'route': {
      const to = text(tile.to, `Tile "${id}" route`, 200, { required: true });
      if (!to.startsWith('/')) throw new Error(`Tile "${id}" route must start with /`);
      return { ...base, to };
    }
    default: // placeholder
      return base;
  }
}

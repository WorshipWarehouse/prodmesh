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

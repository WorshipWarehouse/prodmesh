// Room-mode domain service: current-state reads, mode changes, and the
// lockout-override check shared by the mode endpoint and checklist actions.

import { readCustomVariable, pressButton } from './companion.js';
import { rawToModeId } from './roomModel.js';
import * as settings from './settings.js';
import * as auth from './authStore.js';

// In-memory state used when a room is in mock mode or Companion is unreachable.
// Lazily keyed (?? 'standby' at reads) so rooms created after boot just work.
const mockState = Object.create(null);

// Current room mode (the body of GET /api/rooms/:id/state).
export async function readRoomState(room) {
  const protection = settings.computeProtection(room.id);

  if (room.mock || !room.companion?.host) {
    const raw = mockState[room.id] ?? 'standby';
    return { mode: rawToModeId(room, raw), raw, online: false, source: 'mock', protection };
  }

  try {
    const raw = await readCustomVariable(room.companion, room.state.variable);
    return { mode: rawToModeId(room, raw), raw, online: true, source: 'companion', protection };
  } catch (err) {
    // Fall back to last-known mock state so the page degrades gracefully.
    const raw = mockState[room.id] ?? 'standby';
    return {
      mode: rawToModeId(room, raw),
      raw,
      online: false,
      source: 'mock',
      protection,
      error: String(err.message ?? err),
    };
  }
}

// Set a room's mode: presses the mapped Companion button. Shared by the mode
// endpoint and automated checklist items. Throws if Companion is unreachable.
export async function applyMode(room, mode) {
  // Update mock state regardless, so the UI reflects intent if Companion is down.
  mockState[room.id] = mode.match ?? mode.id;
  if (room.mock || !room.companion?.host) return { online: false, source: 'mock' };
  if (mode.press) await pressButton(room.companion, mode.press);
  return { online: true, source: 'companion' };
}

// Enforce lockout: a locked mode in a protected window needs the Override PIN.
// Returns null when the change is allowed, or the 403 response body when not.
export function modeLockError(req, roomId, modeId, overridePin) {
  if (!settings.isModeLocked(roomId, modeId)) return null;
  const permitted = auth.hasPermission(req.auth, 'rooms.mode.override_lock');
  if (!permitted && !settings.verifyOverride(overridePin)) {
    return { error: 'override_required', mode: modeId };
  }
  return null;
}

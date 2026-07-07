// Pure helpers for turning a room config into API responses. Kept dependency-free
// and side-effect-free so they're easy to unit test.

/** Public view of a room — what the UI needs, without button locations. */
export function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    site: room.site ?? null,
    hasCompanion: Boolean(room.companion?.host) && !room.mock,
    modes: room.modes.map((m) => ({
      id: m.id,
      label: m.label,
      color: m.color,
      isStandby: Boolean(m.isStandby),
    })),
  };
}

/** Map a raw Companion variable value to one of the room's mode ids (or null). */
export function rawToModeId(room, raw) {
  const v = (raw ?? '').trim().toLowerCase();
  const hit = room.modes.find((m) => (m.match ?? m.id).toLowerCase() === v);
  return hit ? hit.id : null;
}

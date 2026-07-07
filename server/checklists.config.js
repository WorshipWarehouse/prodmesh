// ─────────────────────────────────────────────────────────────────────────────
//  STARTUP CHECKLIST TEMPLATES  —  per room × event type.
//
//  Keyed by roomId, then Planning Center service type id ('*' = any other
//  event type in that room). Items are manual (human checks them off) unless
//  they carry an `action`, which the server executes when the item is checked:
//
//    action: { type: 'mode', mode: '<mode id>' }  → set the room mode
//                                                   (presses the Companion button)
//
//  Checklist run state is per-event (planId) and lives in SQLite — this file
//  is only the template. (Editing templates in the Settings UI is a planned
//  follow-up; for now this is the one config the tech team can't edit in-app.)
// ─────────────────────────────────────────────────────────────────────────────

export const checklistTemplates = {
  'local-test': {
    // Sunday
    '500001': [
      { id: 'mode-sunday', label: 'Set room to Sunday mode', action: { type: 'mode', mode: 'sunday' } },
      { id: 'cameras', label: 'Install batteries in mobile cameras' },
      { id: 'ros-sheets', label: 'Place run of show sheets at tech positions' },
      { id: 'packs', label: 'Verify mic + IEM packs are charged' },
    ],
  },

  'north-main': {
    // Sunday
    '500001': [
      { id: 'mode-sunday', label: 'Set room to Sunday mode', action: { type: 'mode', mode: 'sunday' } },
      { id: 'cameras', label: 'Install batteries in mobile cameras' },
      { id: 'ros-sheets', label: 'Place run of show sheets at all tech positions' },
      { id: 'sermon-notes', label: 'Place sermon notes in the PCR' },
      { id: 'packs', label: 'Ensure all mic and IEM packs are charged' },
      { id: 'protools', label: 'Start ProTools session for live stream broadcast audio' },
    ],
    // Any other event type in the Auditorium (Second Service, Midweek, YA, …)
    '*': [
      { id: 'packs', label: 'Ensure mic and IEM packs are charged' },
      { id: 'ros-sheets', label: 'Place run of show sheets at tech positions' },
    ],
  },
};

/** The template for a room + event type ('*' fallback), or []. */
export function templateFor(roomId, serviceTypeId) {
  const room = checklistTemplates[roomId];
  if (!room) return [];
  return room[serviceTypeId] ?? room['*'] ?? [];
}

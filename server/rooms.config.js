// ─────────────────────────────────────────────────────────────────────────────
//  ROOM CONTROL CONFIG  (backend / proxy source of truth)
//
//  Each room maps to a Companion install and a set of MODES. Selecting a mode
//  presses a Companion button (page/row/column). The room's current mode is read
//  from a Companion CUSTOM VARIABLE and matched (case-insensitively) against each
//  mode's `match` value.
//
//  Convention (from the test Companion), per room:
//    • custom variable name:  roomState
//    • buttons page 1, row 3:  col 1=Sunday, 2=Mid-Week, 3=Event, 4=Standby
//    • the buttons set roomState to: SUNDAY / MIDWEEK / EVENT / STANDBY
//
//  TO GO LIVE for a room: confirm the variable name + button locations match that
//  room's Companion, then set `mock: false`.
//  While `mock: true`, the proxy ignores Companion and keeps state in memory so
//  the screens are fully demoable.
// ─────────────────────────────────────────────────────────────────────────────

// Standard mode set. `match` = the roomState value that means this mode is active
// (compared case-insensitively). `press` = the Companion button location.
// Override `page` / `row` per room if a room's layout differs.
function standardModes({ page = 1, row = 3 } = {}) {
  return [
    { id: 'sunday', label: 'Sunday', color: '#34c759', match: 'SUNDAY', press: { page, row, column: 1 } },
    { id: 'midweek', label: 'Mid-Week', color: '#5b8def', match: 'MIDWEEK', press: { page, row, column: 2 } },
    { id: 'special', label: 'Special Event', color: '#af7bf0', match: 'EVENT', press: { page, row, column: 3 } },
    { id: 'standby', label: 'Standby', color: '#8b97a8', match: 'STANDBY', press: { page, row, column: 4 }, isStandby: true },
  ];
}

export const rooms = {
  // ── Local test against the Companion running on THIS machine ────────────────
  'local-test': {
    id: 'local-test',
    name: 'Local Test (this Mac)',
    mock: false, // live — talks to the Companion on 127.0.0.1:8000
    companion: { host: '127.0.0.1', port: 8000 },
    state: { variable: 'roomState' },
    modes: standardModes(),
  },

  // ── North rooms (pre-filled with the standard convention; flip mock when ──
  //    each room's Companion has the roomState variable + row-3 buttons set up) ─
  'north-main': {
    id: 'north-main',
    name: 'North · Main Auditorium',
    // TEMP (dev testing): pointed at this Mac's Companion so the Auditorium
    // Status page is live during development.
    // BEFORE DEPLOY ON-SITE: revert host → '192.0.2.31' and mock → true
    // (or false once that room's Companion is confirmed wired).
    mock: false,
    companion: { host: '127.0.0.1', port: 8000 }, // TEMP — real: 192.0.2.31 (Producer)
    state: { variable: 'roomState' },
    modes: standardModes(),
  },

  'north-youth': {
    id: 'north-youth',
    name: 'North · Youth',
    mock: true,
    companion: { host: '192.0.2.150', port: 8000 }, // Lighting machine
    state: { variable: 'roomState' },
    modes: standardModes(),
  },

  'north-chapel': {
    id: 'north-chapel',
    name: 'North · Chapel',
    mock: true,
    companion: { host: '192.0.2.101', port: 8000 }, // Chapel-Mac machine
    state: { variable: 'roomState' },
    modes: standardModes(),
  },
};

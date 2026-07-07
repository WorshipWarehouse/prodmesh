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

// Build a single mode. `match` = the roomState value (case-insensitive) that
// means this mode is active; `loc` = [page, row, column] of the Companion button.
function mode(id, label, color, match, [page, row, column], extra = {}) {
  return { id, label, color, match, press: { page, row, column }, ...extra };
}

export const rooms = {
  // ── Local test against the Companion running on THIS machine ────────────────
  'local-test': {
    id: 'local-test',
    name: 'Local Test (this Mac)',
    site: 'north',
    mock: false, // live — talks to the Companion on 127.0.0.1:8000
    companion: { host: '127.0.0.1', port: 8000 },
    state: { variable: 'roomState' },
    // Planning Center service type(s) whose plans feed this room. A room can
    // host several (the soonest upcoming plan across them is shown).
    planningCenter: { serviceTypes: [{ id: '500001', name: 'Sunday' }] }, // live demo
    // ProPresenter API (official 7.9+). Port is per-machine (PP picks it).
    // Optional `timer: '<name>'` picks the service-start countdown timer;
    // without it, the first count-down-to-time timer is used.
    proPresenter: { host: '127.0.0.1', port: 62202 },
    // Smaart SPL — mock meter for dev (no Smaart on this machine).
    // target/limit in dB: our Sundays target 90, not to exceed 95.
    smaart: { mock: true, target: 90, limit: 95 },
    modes: standardModes(),
  },

  // ── North rooms (pre-filled with the standard convention; flip mock when ──
  //    each room's Companion has the roomState variable + row-3 buttons set up) ─
  'north-main': {
    id: 'north-main',
    name: 'North · Main Auditorium',
    site: 'north',
    mock: false, // LIVE — Companion runs on this same (Producer) Mac in production
    companion: { host: '192.0.2.31', port: 8000 }, // Producer machine
    state: { variable: 'roomState' },
    planningCenter: {
      serviceTypes: [
        { id: '500001', name: 'Sunday' },
        { id: '500002', name: 'Second Service' },
        { id: '500003', name: "Midweek" },
        { id: '500004', name: 'Evening' },
        // "Special Events" (265639) intentionally omitted: its plans aren't
        // reliably in this room. Add once Calendar can confirm room (see ADR 0001).
      ],
    },
    proPresenter: { host: '192.0.2.74', port: 62202 }, // ProPresenter (confirm port on-site)
    // Smaart SPL — live transport is implemented (SDK v4, integrations/smaart.js);
    // fill in the FOH Mac once Smaart's API is enabled there (Options → API,
    // default port 26000). Optional: password, device/channel (default: first
    // logging input), metric (default 'SPL A Slow').
    // smaart: { host: '<FOH Mac>', port: 26000, target: 90, limit: 95 },
    // Auditorium-specific modes. Button locations [page, row, column].
    modes: [
      mode('sunday', 'Sunday', '#34c759', 'SUNDAY', [3, 0, 1]),
      mode('second', 'Second Service', '#ff9f0a', 'SECOND', [3, 0, 2]),
      mode('womens', "Midweek", '#ff6fae', 'WOMENS', [3, 0, 3]),
      mode('ya', 'Evening', '#32ade6', 'YA', [3, 0, 4]),
      mode('event', 'Event', '#af7bf0', 'EVENT', [3, 0, 5]),
      mode('standby', 'Standby', '#8b97a8', 'STANDBY', [3, 3, 1], { isStandby: true }),
    ],
  },

  'north-youth': {
    id: 'north-youth',
    name: 'North · Youth',
    site: 'north',
    mock: true,
    companion: { host: '192.0.2.150', port: 8000 }, // Lighting machine
    state: { variable: 'roomState' },
    planningCenter: { serviceTypes: [{ id: '500005', name: 'Youth Service' }] },
    modes: standardModes(),
  },

  'north-chapel': {
    id: 'north-chapel',
    name: 'North · Chapel',
    site: 'north',
    mock: true,
    companion: { host: '192.0.2.101', port: 8000 }, // Chapel-Mac machine
    state: { variable: 'roomState' },
    planningCenter: { serviceTypes: [{ id: '500006', name: 'Chapel Service' }] },
    modes: standardModes(),
  },
};

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRooms, validateSchedules, validateView } from './validate.js';

const goodRoom = {
  r1: {
    id: 'r1',
    name: 'Room One',
    mock: true,
    companion: { host: '10.0.0.5', port: 8000 },
    state: { variable: 'roomState' },
    modes: [
      { id: 'sunday', label: 'Sunday', match: 'SUNDAY', press: { page: 1, row: 0, column: 1 } },
    ],
  },
};

test('validateRooms accepts a well-formed config', () => {
  assert.doesNotThrow(() => validateRooms(structuredClone(goodRoom)));
});

test('validateRooms rejects a key/id mismatch', () => {
  const bad = { r1: { ...goodRoom.r1, id: 'other' } };
  assert.throws(() => validateRooms(bad), /must match its key/);
});

test('validateRooms rejects empty modes', () => {
  const bad = { r1: { ...goodRoom.r1, modes: [] } };
  assert.throws(() => validateRooms(bad), /non-empty modes/);
});

test('validateRooms rejects duplicate mode ids', () => {
  const m = { id: 'sunday', label: 'S', match: 'SUNDAY' };
  const bad = { r1: { ...goodRoom.r1, modes: [m, { ...m }] } };
  assert.throws(() => validateRooms(bad), /duplicate mode id/);
});

test('validateRooms rejects a non-integer press location', () => {
  const bad = structuredClone(goodRoom);
  bad.r1.modes[0].press.column = 'x';
  assert.throws(() => validateRooms(bad), /press\.column must be an integer/);
});

test('validateRooms requires companion+variable for live rooms', () => {
  const bad = { r1: { ...goodRoom.r1, mock: false, companion: undefined } };
  assert.throws(() => validateRooms(bad), /no companion\.host/);
});

test('validateSchedules accepts valid windows and rejects bad ones', () => {
  assert.doesNotThrow(() =>
    validateSchedules({ r1: [{ id: 'w', label: 'x', days: [0, 6], start: '07:00', end: '13:30', lock: ['standby'] }] }));
  assert.throws(() => validateSchedules({ r1: [{ days: [9], start: '07:00', end: '08:00', lock: [] }] }), /days/);
  assert.throws(() => validateSchedules({ r1: [{ days: [0], start: '7am', end: '08:00', lock: [] }] }), /HH:MM/);
});

// ── Views ───────────────────────────────────────────────────────────────────

const view = (over = {}) => ({ kind: 'dashboard', name: 'FOH', slug: 'foh', widgets: [], ...over });
const at = (type, x, y, w = 1, h = 1) => ({ type, x, y, w, h });

test('validateView normalizes: derives the grid, orders by (y,x), drops junk', () => {
  const out = validateView(view({
    name: '  FOH  ',
    widgets: [at('viewers', 3, 1), at('countdown', 0, 0, 2, 1)],
  }));
  assert.equal(out.name, 'FOH', 'trimmed');
  assert.equal(out.columns, 6, 'derived from kind, never taken from the client');
  assert.equal(out.maxRows, null, 'a dashboard grows');
  assert.deepEqual(out.widgets.map((w) => w.type), ['countdown', 'viewers'], 'reading order');
  assert.deepEqual(out.widgets.map((w) => w.position), [0, 1]);

  // A client cannot pick its own grid.
  assert.equal(validateView(view({ columns: 12000, maxRows: 999 })).columns, 6);
  assert.equal(validateView(view({ kind: 'display', slug: 'wall' })).maxRows, 3);
});

test('validateView drops unknown widget config keys rather than rejecting', () => {
  // Same discipline as validateTile: a view written by a newer build should
  // lose the field this one doesn't understand, not fail to save.
  const out = validateView(view({
    widgets: [{ ...at('countdown', 0, 0), config: { planId: 'p1', timeId: 't1', junk: 'x', nested: {} } }],
  }));
  assert.deepEqual(out.widgets[0].config, { planId: 'p1', timeId: 't1' });
  assert.deepEqual(validateView(view({ widgets: [at('countdown', 0, 0)] })).widgets[0].config, {});
});

test('validateView rejects every malformed layout', () => {
  assert.throws(() => validateView(view({ kind: 'wall' })), /dashboard or display/);
  assert.throws(() => validateView(view({ name: '' })), /1–60 characters/);
  assert.throws(() => validateView(view({ name: 'x'.repeat(61) })), /1–60 characters/);
  assert.throws(() => validateView(view({ slug: 'Not A Slug' })), /lowercase letters/);
  assert.throws(() => validateView(view({ widgets: Array.from({ length: 41 }, () => at('countdown', 0, 0)) })),
    /at most 40 widgets/);
  assert.throws(() => validateView(view({ widgets: [at('nope', 0, 0)] })), /Unknown widget type "nope"/);
  assert.throws(() => validateView(view({ widgets: [at('countdown', 0, 0), at('countdown', 1, 0)] })),
    /"countdown" can only be placed once/);
  assert.throws(() => validateView(view({ widgets: [{ ...at('countdown', 0, 0), x: 1.5 }] })),
    /integer grid coordinates/);
  assert.throws(() => validateView(view({ widgets: [at('countdown', 5, 0, 2, 1)] })),
    /outside the 6-column grid/);
  assert.throws(() => validateView(view({ widgets: [at('countdown', 0, 24)] })), /max 24 rows/);
  assert.throws(() => validateView(view({ kind: 'display', widgets: [at('countdown', 0, 0, 1, 4)] })),
    /does not fit a display's 3×3 grid/);
});

test('validateView names both widgets in an overlap', () => {
  assert.throws(
    () => validateView(view({ widgets: [at('loudness', 0, 0, 2, 2), at('viewers', 1, 1, 2, 2)] })),
    /Widgets "loudness" and "viewers" overlap/,
  );
  // Edge-touching is not overlapping.
  assert.doesNotThrow(() => validateView(view({ widgets: [at('loudness', 0, 0, 2, 2), at('viewers', 2, 0, 2, 2)] })));
});

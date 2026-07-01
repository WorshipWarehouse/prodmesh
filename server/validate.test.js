import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRooms, validateSchedules } from './validate.js';

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

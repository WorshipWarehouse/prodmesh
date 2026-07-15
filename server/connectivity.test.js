import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'prodmesh-conn-'));
process.env.PRODMESH_LOCAL_TEST = '1'; // include the dev room in the map
const { rooms } = await import('./rooms.config.js');
const conn = await import('./connectivity.js');

test('first boot seeds service types from rooms.config.js', () => {
  const stored = conn.getPlanningCenter('north-main');
  assert.ok(stored.serviceTypes.length >= 4);
  assert.ok(stored.serviceTypes.some((st) => st.name === 'Sunday'));
  assert.deepEqual(conn.getPlanningCenter('north-youth').serviceTypes, [{ id: '500005', name: 'Youth Service' }]);
});

test('setPlanningCenter validates, persists, and applies to the live rooms map', () => {
  const next = [
    { id: '500005', name: 'Youth Service' },
    { id: '999001', name: 'Youth Winter Camp' },
  ];
  conn.setPlanningCenter('north-youth', next);
  // Persisted…
  assert.deepEqual(conn.getPlanningCenter('north-youth').serviceTypes, next);
  // …and live on the shared room object every consumer holds.
  assert.deepEqual(rooms['north-youth'].planningCenter.serviceTypes, next);
});

test('setPlanningCenter rejects bad input without changing anything', () => {
  const before = conn.getPlanningCenter('north-chapel');
  assert.throws(() => conn.setPlanningCenter('north-chapel', [{ id: 'abc', name: 'X' }]), /must be numeric/);
  assert.throws(() => conn.setPlanningCenter('north-chapel', [{ id: '1', name: '' }]), /needs a name/);
  assert.throws(
    () => conn.setPlanningCenter('north-chapel', [{ id: '1', name: 'A' }, { id: '1', name: 'B' }]),
    /Duplicate/,
  );
  assert.throws(() => conn.setPlanningCenter('nope', []), /Unknown room/);
  assert.deepEqual(conn.getPlanningCenter('north-chapel'), before);
});

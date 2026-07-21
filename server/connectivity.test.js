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

test('first boot seeds the analysis source from rooms.config.js', () => {
  const stored = conn.getAnalysis('north-main');
  assert.equal(stored.source, 'smaart');
  assert.equal(stored.host, '192.0.2.7');
  assert.equal(stored.target, 90);
  // The dev room's mock fixture seeds too (and rooms without one stay bare).
  assert.equal(conn.getAnalysis('local-test').mock, true);
  assert.equal(conn.getAnalysis('north-youth'), null);
});

test('setAnalysis validates, persists, and applies to the live rooms map', () => {
  const clean = conn.setAnalysis('north-youth', {
    source: 'rta', host: '192.0.2.99', port: '8517', target: '88', limit: '', metric: 'leqS',
  });
  assert.deepEqual(clean, { source: 'rta', host: '192.0.2.99', port: 8517, target: 88, metric: 'leqS' });
  assert.deepEqual(rooms['north-youth'].analysis, clean);
  // Clearing removes it from the database AND the live room object…
  conn.setAnalysis('north-youth', null);
  assert.equal(conn.getAnalysis('north-youth'), null);
  assert.equal(rooms['north-youth'].analysis, undefined);
});

test('a cleared analysis source stays cleared across applyConnectivity', () => {
  // north-main declares an analysis block in rooms.config.js; once cleared,
  // the seeded marker keeps the file entry from resurrecting it.
  conn.setAnalysis('north-main', null);
  conn.applyConnectivity();
  assert.equal(rooms['north-main'].analysis, undefined);
  // Restore for any later tests.
  conn.setAnalysis('north-main', { source: 'smaart', host: '192.0.2.7', port: 26000, target: 90, limit: 95 });
});

test('setAnalysis rejects bad input without changing anything', () => {
  const before = conn.getAnalysis('north-main');
  assert.throws(() => conn.setAnalysis('north-main', { source: 'loudness-o-matic', host: 'x' }), /Unknown analysis source/);
  assert.throws(() => conn.setAnalysis('north-main', { source: 'rta' }), /needs a host/);
  assert.throws(() => conn.setAnalysis('north-main', { source: 'rta', host: 'x', port: 99999 }), /Port must be/);
  assert.throws(() => conn.setAnalysis('north-main', { source: 'rta', host: 'x', target: 20 }), /must be 40–130/);
  assert.throws(() => conn.setAnalysis('north-main', { source: 'rta', host: 'x', target: 95, limit: 90 }), /at or above target/);
  assert.throws(() => conn.setAnalysis('nope', null), /Unknown room/);
  assert.deepEqual(conn.getAnalysis('north-main'), before);
});

test('the password survives storage but only for Smaart sources', () => {
  const smaart = conn.validateAnalysis({ source: 'smaart', host: 'x', password: 'hunter2' });
  assert.equal(smaart.password, 'hunter2');
  const rta = conn.validateAnalysis({ source: 'rta', host: 'x', password: 'hunter2' });
  assert.equal(rta.password, undefined);
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

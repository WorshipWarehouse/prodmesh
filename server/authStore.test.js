import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-auth-'));
const auth = await import('./authStore.js');

test('station identity is token-backed but grants no authority', () => {
  const station = auth.registerStation({ name: 'FOH – Producer', campusId: 'north' });
  assert.equal(auth.resolveStation(station.token).name, 'FOH – Producer');
  assert.equal(auth.resolveStation('wrong-token'), null);
  assert.equal(auth.hasPermission(null, 'rooms.mode.change'), false);
});

test('user receives the union of assigned group permissions', () => {
  const checklist = auth.createGroup({ name: 'Checklist Operators', permissions: ['checklists.complete'] });
  const rooms = auth.createGroup({ name: 'Room Operators', permissions: ['rooms.mode.change'] });
  const user = auth.createUser({
    username: 'jordan',
    displayName: 'Jordan Operator',
    pin: '2468',
    planningCenterPersonId: '12345',
    groupIds: [checklist.id, rooms.id],
  });
  assert.deepEqual(user.permissions, ['checklists.complete', 'rooms.mode.change']);
  const station = auth.registerStation({ name: 'Broadcast – Producer' });
  const session = auth.authenticate('JORDAN', '2468', station.id);
  assert.equal(session.user.displayName, 'Jordan Operator');
  assert.equal(auth.hasPermission(session, 'checklists.complete'), true);
  assert.equal(auth.hasPermission(session, 'system.update'), false);
  assert.equal(auth.authenticate('jordan', 'bad', station.id), null);
});

test('Administrators system group grants wildcard authority', () => {
  const admin = auth.createUser({
    username: 'admin-user',
    displayName: 'Named Administrator',
    pin: '9876',
    groupIds: ['group-admin'],
  });
  assert.deepEqual(admin.permissions, ['*']);
  const session = auth.authenticate('admin-user', '9876');
  assert.equal(auth.hasPermission(session, 'anything.future'), true);
});

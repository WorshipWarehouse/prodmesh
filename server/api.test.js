import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated store + import the app (which won't listen on its own).
process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-api-'));
const { app } = await import('./index.js');
const settings = await import('./settings.js');
const auth = await import('./authStore.js');

// north-youth is mock:true, so mode presses resolve in-memory (no Companion).
const ROOM = 'north-youth';
settings.setPins({ admin: '1234', override: '9999' });
settings.setSchedules({
  [ROOM]: [{ id: 't', label: 'Test Lock', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', lock: ['standby'] }],
});
const operatorGroup = auth.createGroup({ name: 'Mode Operators', permissions: ['rooms.mode.change'] });
auth.createUser({ username: 'operator', displayName: 'Test Operator', pin: '2468', groupIds: [operatorGroup.id] });
const station = auth.registerStation({ name: 'API Test Station' });

let base;
let server;
let operatorToken;
before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await post('/api/auth/login', { username: 'operator', pin: '2468' }, null, station.token);
  operatorToken = (await login.json()).token;
});
after(() => server.close());

function post(path, body, token, stationToken = null) {
  return fetch(base + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(stationToken ? { 'X-Prodmesh-Station': stationToken } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('admin login rejects a wrong PIN and accepts the right one', async () => {
  assert.equal((await post('/api/auth/admin', { pin: '0000' })).status, 401);
  const res = await post('/api/auth/admin', { pin: '1234' });
  assert.equal(res.status, 200);
  const { token } = await res.json();
  assert.ok(token);
});

test('settings endpoint requires an admin token', async () => {
  assert.equal((await fetch(base + '/api/settings')).status, 401);
  const { token } = await (await post('/api/auth/admin', { pin: '1234' })).json();
  const ok = await fetch(base + '/api/settings', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(ok.status, 200);
});

test('user directory includes the avatar contract', async () => {
  const { token } = await (await post('/api/auth/admin', { pin: '1234' })).json();
  const res = await fetch(base + '/api/users', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const directory = await res.json();
  assert.ok(directory.users.length > 0);
  assert.ok(directory.users.every((user) => Object.hasOwn(user, 'avatarUrl')));
});

test('locked mode is blocked without override, allowed with it', async () => {
  const blocked = await post(`/api/rooms/${ROOM}/mode`, { mode: 'standby' }, operatorToken, station.token);
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error, 'override_required');

  const wrong = await post(`/api/rooms/${ROOM}/mode`, { mode: 'standby', overridePin: '0000' }, operatorToken, station.token);
  assert.equal(wrong.status, 403);

  const ok = await post(`/api/rooms/${ROOM}/mode`, { mode: 'standby', overridePin: '9999' }, operatorToken, station.token);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).mode, 'standby');
});

test('unlocked mode needs no PIN', async () => {
  const res = await post(`/api/rooms/${ROOM}/mode`, { mode: 'sunday' }, operatorToken, station.token);
  assert.equal(res.status, 200);
});

test('anonymous stations remain read-only', async () => {
  const res = await post(`/api/rooms/${ROOM}/mode`, { mode: 'sunday' }, null, station.token);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'permission_required');
});

test('room state exposes protection info', async () => {
  const state = await (await fetch(`${base}/api/rooms/${ROOM}/state`)).json();
  assert.equal(state.protection.active, true);
  assert.equal(state.protection.enforced, true);
  assert.deepEqual(state.protection.lockedModes, ['standby']);
});

test('unknown room returns 404', async () => {
  assert.equal((await fetch(base + '/api/rooms/nope/state')).status, 404);
});

test('services overview lists configured rooms (mock)', async () => {
  const body = await (await fetch(base + '/api/services')).json();
  assert.equal(body.live, false); // no PC token in tests
  assert.ok(body.services.length > 0);
  assert.ok(body.services.every((s) => s.roomId && s.serviceType));
});

test("room service returns the next plan with an order of service", async () => {
  const body = await (await fetch(`${base}/api/rooms/north-main/service`)).json();
  assert.equal(body.configured, true);
  assert.ok(body.plans.length > 0);
  assert.ok(body.plans[0].items.length > 0); // items filled for the next plan
  assert.ok(body.plans[0].times.length > 0);
});

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated store + import the app (which won't listen on its own).
process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-api-'));
const { app } = await import('./index.js');
const settings = await import('./settings.js');

// north-youth is mock:true, so mode presses resolve in-memory (no Companion).
const ROOM = 'north-youth';
settings.setPins({ admin: '1234', override: '9999' });
settings.setSchedules({
  [ROOM]: [{ id: 't', label: 'Test Lock', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', lock: ['standby'] }],
});

let base;
let server;
before(() => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body, token) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

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

test('locked mode is blocked without override, allowed with it', async () => {
  const blocked = await post(`/api/rooms/${ROOM}/mode`, { mode: 'standby' });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error, 'override_required');

  const wrong = await post(`/api/rooms/${ROOM}/mode`, { mode: 'standby', overridePin: '0000' });
  assert.equal(wrong.status, 403);

  const ok = await post(`/api/rooms/${ROOM}/mode`, { mode: 'standby', overridePin: '9999' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).mode, 'standby');
});

test('unlocked mode needs no PIN', async () => {
  const res = await post(`/api/rooms/${ROOM}/mode`, { mode: 'sunday' });
  assert.equal(res.status, 200);
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

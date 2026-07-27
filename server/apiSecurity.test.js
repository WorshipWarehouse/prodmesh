// Security-boundary tests: the admin-PIN bootstrap exception, login lockout,
// and the permission gates on show control + checklist mode actions. These run
// against a fresh store (no admin PIN) — api.test.js covers the configured
// steady state, this file covers the edges around getting there.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-sec-'));
const { app } = await import('./index.js');
const settings = await import('./settings.js');
const auth = await import('./authStore.js');
const chkTemplates = await import('./checklistTemplates.js');

// north-youth is mock:true (no Companion network calls) with PC service type 500005.
const ROOM = 'north-youth';

const operatorGroup = auth.createGroup({ name: 'Mode Operators', permissions: ['rooms.mode.change'] });
const checkerGroup = auth.createGroup({ name: 'Checkers', permissions: ['checklists.complete'] });
const runnerGroup = auth.createGroup({ name: 'Runners', permissions: ['checklists.complete', 'rooms.mode.change'] });
auth.createUser({ username: 'operator', displayName: 'Operator', pin: '2468', groupIds: [operatorGroup.id] });
auth.createUser({ username: 'checker', displayName: 'Checker', pin: '3579', groupIds: [checkerGroup.id] });
auth.createUser({ username: 'runner', displayName: 'Runner', pin: '4680', groupIds: [runnerGroup.id] });
const station = auth.registerStation({ name: 'Security Test Station' });

let base;
let server;
let operatorToken;
let checkerToken;
let runnerToken;
before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const login = async (username, pin) => {
    const res = await post('/api/auth/login', { username, pin }, null, station.token);
    return (await res.json()).token;
  };
  operatorToken = await login('operator', '2468');
  checkerToken = await login('checker', '3579');
  runnerToken = await login('runner', '4680');
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

test('admin-PIN bootstrap: open exactly once, admin field only', async () => {
  assert.equal(settings.isAdminSetupNeeded(), true);

  // An override-only body does NOT ride the bootstrap exception.
  assert.equal((await post('/api/settings/pins', { override: '9999' })).status, 401);

  // First-run setup: the first anonymous admin-PIN set is allowed…
  assert.equal((await post('/api/settings/pins', { admin: '1234' })).status, 200);
  assert.equal(settings.isAdminSetupNeeded(), false);

  // …and never again: anonymous → 401, an authed non-admin → 403.
  assert.equal((await post('/api/settings/pins', { admin: '5678' })).status, 401);
  const denied = await post('/api/settings/pins', { admin: '5678' }, operatorToken, station.token);
  assert.equal(denied.status, 403);

  // The refused attempts changed nothing.
  assert.equal((await post('/api/auth/admin', { pin: '5678' })).status, 401);
  assert.equal((await post('/api/auth/admin', { pin: '1234' })).status, 200);
});

test('show start/end/current require shows.operate; reads stay public', async () => {
  for (const action of ['start', 'end', 'current']) {
    const anon = await post(`/api/rooms/${ROOM}/show/${action}`, {}, null, station.token);
    assert.equal(anon.status, 401, `anonymous ${action}`);
    assert.equal((await anon.json()).error, 'permission_required');

    const denied = await post(`/api/rooms/${ROOM}/show/${action}`, {}, operatorToken, station.token);
    assert.equal(denied.status, 403, `unpermitted ${action}`);
    assert.equal((await denied.json()).permission, 'shows.operate');
  }
  // Booth screens are anonymous viewers — the read side must stay open.
  assert.equal((await fetch(`${base}/api/rooms/${ROOM}/show`)).status, 200);
});

test('checklist mode actions enforce mode permission and lockouts', async () => {
  chkTemplates.setTemplate('500005', [
    { id: 'go-sunday', label: 'Set room to Sunday mode', action: { type: 'mode', mode: 'sunday' } },
    { id: 'plain', label: 'A plain item' },
  ]);
  const service = await (await fetch(`${base}/api/rooms/${ROOM}/service`)).json();
  const plan = service.plans[0];
  assert.ok(plan, 'mock Planning Center should supply a plan');
  const url = (item) => `/api/rooms/${ROOM}/event/${plan.id}/checklist/${item}`;

  // Anonymous ticking is refused outright.
  assert.equal((await post(url('plain'), { done: true }, null, station.token)).status, 401);

  // checklists.complete alone ticks plain items but cannot fire a mode action.
  assert.equal((await post(url('plain'), { done: true }, checkerToken, station.token)).status, 200);
  const noMode = await post(url('go-sunday'), { done: true }, checkerToken, station.token);
  assert.equal(noMode.status, 403);
  assert.equal((await noMode.json()).permission, 'rooms.mode.change');

  // A locked mode can't be sidestepped through the checklist…
  settings.setPins({ admin: '1234', override: '9999' });
  settings.setSchedules({
    [ROOM]: [{ id: 'w', label: 'Always', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', lock: ['sunday'] }],
  });
  const locked = await post(url('go-sunday'), { done: true }, runnerToken, station.token);
  assert.equal(locked.status, 403);
  assert.equal((await locked.json()).error, 'override_required');

  // …until the override PIN is supplied; then the mode fires and the item ticks.
  const done = await post(url('go-sunday'), { done: true, overridePin: '9999' }, runnerToken, station.token);
  assert.equal(done.status, 200);
  const { checklist } = await done.json();
  assert.equal(checklist.find((i) => i.id === 'go-sunday').done, true);

  settings.setSchedules({});
});

test('login lockout: 5 failures lock the station+username pair', async () => {
  // No station header → explicit station_required, not a silent 401.
  assert.equal((await post('/api/auth/login', { username: 'lockme', pin: '1111' })).status, 400);

  auth.createUser({ username: 'lockme', displayName: 'Lockout Target', pin: '7777', groupIds: [] });
  for (let i = 0; i < 5; i++) {
    const res = await post('/api/auth/login', { username: 'lockme', pin: '0000' }, null, station.token);
    assert.equal(res.status, 401, `failure ${i + 1} still reports bad credentials`);
  }

  // Once locked, even the CORRECT pin is refused until the window passes.
  const locked = await post('/api/auth/login', { username: 'lockme', pin: '7777' }, null, station.token);
  assert.equal(locked.status, 429);
  const body = await locked.json();
  assert.equal(body.error, 'temporarily_locked');
  assert.ok(body.retryAfter > 0 && body.retryAfter <= 60_000);

  // The lock is keyed per station+username — other users are unaffected.
  const other = await post('/api/auth/login', { username: 'operator', pin: '2468' }, null, station.token);
  assert.equal(other.status, 200);
});

// ── Planning Center path injection ───────────────────────────────────────────
//  A planId is persisted and later replayed into PC request paths by
//  backfillLabels. Before this guard, "1/../../../people/v2/people" escaped
//  the /services/v2 prefix (fetch normalizes `..`) and reached the People API
//  with the church's PAT — congregant names, emails and addresses, readable by
//  anyone holding only shows.operate. Reproduce the exact payload, not a
//  sanitized stand-in: this is the kind of bug that returns during a refactor.

test('show start rejects plan ids that could reshape a Planning Center path', async () => {
  const runner = auth.createGroup({ name: 'PC Injection Ops', permissions: ['shows.operate'] });
  auth.createUser({ username: 'pcinj', displayName: 'PC Inj', pin: '9182', groupIds: [runner.id] });
  const res0 = await post('/api/auth/login', { username: 'pcinj', pin: '9182' }, null, station.token);
  const token = (await res0.json()).token;

  const payloads = [
    '1/../../../people/v2/people?per_page=100', // the reproduced escape
    '../../people/v2/people',
    '1%2F..%2F..%2Fpeople',                     // pre-encoded traversal
    '1?filter=x',                               // query injection
    '1#frag',                                   // fragment truncation
    '1/notes',                                  // extra path segment
  ];
  for (const planId of payloads) {
    const res = await post(`/api/rooms/${ROOM}/show/start`, { planId, timeId: 't1' }, token, station.token);
    assert.equal(res.status, 400, `planId ${JSON.stringify(planId)} must be refused`);
    assert.equal((await res.json()).error, 'Invalid plan id');
  }

  // Demo-mode ids (no PC credentials) must still be accepted — the charset
  // guard blocks URL metacharacters, it does not require digits.
  const ok = await post(`/api/rooms/${ROOM}/show/start`, { planId: 'mock-st1-0', timeId: 't1' }, token, station.token);
  assert.equal(ok.status, 200, 'demo-mode plan ids must keep working');
  await post(`/api/rooms/${ROOM}/show/end`, {}, token, station.token);
});

test('the Planning Center id guard refuses anything that is not a bare number', async () => {
  // Second line of defence, unit-tested directly: with no PC credentials the
  // client short-circuits to mock data before building a URL, so the guard is
  // unreachable through the public functions in this environment. It still has
  // to hold for installs that ARE configured, where a planId poisoned before
  // the route guard existed gets replayed by backfillLabels.
  const { pcId } = await import('./integrations/planningCenter.js');

  assert.equal(pcId('12345', 'plan id'), '12345');
  for (const bad of [
    '1/../../../people/v2/people?per_page=100',
    '../../people/v2/people',
    '1%2F..%2Fpeople',
    '1?filter=x',
    '1#frag',
    '1/notes',
    'mock-st1-0', // demo ids are fine to STORE but must never reach a real URL
    '',
    null,
    undefined,
  ]) {
    assert.throws(() => pcId(bad, 'plan id'), /Invalid Planning Center plan id/,
      `${JSON.stringify(bad)} must be refused`);
  }
});

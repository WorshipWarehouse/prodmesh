// Boot recovery: restoreShows() resuming a persisted active show (and skipping
// corrupt files) — the path the server takes after a mid-show restart.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Seed the shows directory BEFORE showManager computes SHOWS_DIR at import.
const dataDir = mkdtempSync(join(tmpdir(), 'prodmesh-restore-'));
process.env.PRODMESH_DATA_DIR = dataDir;
const showsDir = join(dataDir, 'shows');
mkdirSync(showsDir, { recursive: true });

// A real seeded room + a mock-PC plan id, persisted as an active show whose
// SPL logging was started by the dashboard (must survive the restart).
const ROOM = 'north-youth';
const PLAN = 'mock-500005-0';
const STARTED_AT = Date.now() - 5 * 60 * 1000;
writeFileSync(
  join(showsDir, `${ROOM}.json`),
  JSON.stringify({ roomId: ROOM, planId: PLAN, timeId: 'svc-2', startedAt: STARTED_AT, startedLogging: true, status: 'active' }),
);
// A corrupt file sitting next to it must be skipped, not crash the boot.
writeFileSync(join(showsDir, 'corrupt.json'), '{ definitely not: json');

const sm = await import('./showManager.js');

test('restoreShows resumes the persisted show and skips the corrupt file', async () => {
  await sm.restoreShows(); // must not throw despite corrupt.json

  const st = sm.getState(ROOM);
  assert.equal(st.active, true);
  assert.equal(st.planId, PLAN);
  assert.equal(st.timeId, 'svc-2');
  assert.equal(st.startedAt, STARTED_AT);
  assert.equal(st.follow, true);

  // beginShow re-persisted the show — startedLogging must survive the round
  // trip so end-of-show knows to turn Smaart's SPL logging back off.
  const persisted = JSON.parse(readFileSync(join(showsDir, `${ROOM}.json`), 'utf8'));
  assert.equal(persisted.startedLogging, true);
  assert.equal(persisted.status, 'active');
  assert.equal(persisted.startedAt, STARTED_AT);

  // The corrupt file was left in place (skipped) and started nothing.
  assert.ok(existsSync(join(showsDir, 'corrupt.json')));
  assert.equal(sm.getState('north-main').active, false);
  assert.equal(sm.getState('north-chapel').active, false);

  // Restoring again is a no-op while the show is live (no duplicate).
  await sm.restoreShows();
  assert.equal(sm.getState(ROOM).startedAt, STARTED_AT);

  sm.endShow(ROOM);
  assert.equal(sm.getState(ROOM).active, false);
  assert.equal(existsSync(join(showsDir, `${ROOM}.json`)), false, 'ending removes the show file');
});

test('restore falls back to the persisted order of service when the plan is unavailable', async () => {
  const ROOM2 = 'north-chapel';
  // A plan id nothing can resolve (PCO outage / plan aged out), but the show
  // file carries the items hydrated when the show originally started.
  const items = [
    { id: 'i-a', sequence: 1, title: 'Walk In', type: 'item', length: 300, key: null, leader: null, description: null },
    { id: 'i-b', sequence: 2, title: 'Message', type: 'item', length: 1800, key: null, leader: null, description: null },
  ];
  writeFileSync(
    join(showsDir, `${ROOM2}.json`),
    JSON.stringify({ roomId: ROOM2, planId: 'gone-plan-999', timeId: 'default', startedAt: Date.now() - 60_000, status: 'active', items }),
  );

  await sm.restoreShows();
  assert.equal(sm.getState(ROOM2).active, true);

  // The item list is live — manual tracking still resolves names/indexes.
  sm.setCurrent(ROOM2, { itemId: 'i-b' });
  assert.equal(sm.getState(ROOM2).current.itemName, 'Message');

  // And it re-persisted, so the NEXT restart during the outage works too.
  const persisted = JSON.parse(readFileSync(join(showsDir, `${ROOM2}.json`), 'utf8'));
  assert.equal(persisted.items.length, 2);
  assert.equal(persisted.items[1].title, 'Message');

  sm.endShow(ROOM2);
});

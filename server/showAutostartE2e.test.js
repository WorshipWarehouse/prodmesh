// End-to-end autostart: the per-room watcher loop polling a fake ProPresenter
// and starting a real show. Timing is compressed via the test-only cadence
// overrides (see the PRODMESH_AUTOSTART_TEST comment in showManager.js).

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// All env must be set BEFORE showManager is imported.
process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-autostart-e2e-'));
process.env.PRODMESH_AUTOSTART_TEST = '1'; // arm regardless of the clock
process.env.PRODMESH_AUTOSTART_POLL_MS = '100'; // PP poll: 3s → 100ms
process.env.PRODMESH_AUTOSTART_ARM_MS = '2000'; // re-arm check: 60s → 2s

const sm = await import('./showManager.js');
const conn = await import('./connectivity.js');
const showCfg = await import('./showConfig.js');
const pco = await import('./integrations/planningCenter.js');
const { fakeProPresenter } = await import('./integrations/fakeProPresenter.js');

// north-chapel has planningCenter service types (mock PC supplies the plans)
// and no seeded ProPresenter — we point it at the fake.
const ROOM = 'north-chapel';
const ST = { id: '500006', name: 'Chapel Service' };

async function waitFor(predicate, what, timeoutMs = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`timed out waiting for ${what}`);
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = await fakeProPresenter();
after(async () => {
  if (sm.getState(ROOM).active) sm.endShow(ROOM);
  conn.setProPresenter(ROOM, null); // watcher goes idle (unref'd sleeps only)
  await srv.close();
});

// Mock item list: index 4 = "Praise" (a song) is our start item.
const plan = (await pco.getUpcomingPlans(ST, 3))[0];
const items = await pco.getPlanItems(ST, plan.id);
const START = items[4];
assert.equal(START.title, 'Praise'); // sanity: the mock fixture we rely on

test('PP sitting ON the start item at watcher start does not trigger', async () => {
  // ProPresenter is already showing the start item before the watcher exists —
  // e.g. the server rebooted mid-worship. No baseline transition → no show.
  srv.setActive(4, 'Praise');
  showCfg.setConfig(ROOM, plan.id, { startItemId: START.id });
  conn.setProPresenter(ROOM, { host: '127.0.0.1', port: srv.port() });

  sm.initAutomation(); // boot the per-room watchers
  await waitFor(() => srv.seen.requests >= 4, 'the watcher to poll PP a few times');
  await settle(300); // several more poll cycles for good measure
  assert.equal(sm.getState(ROOM).active, false, 'must not start without a transition');
});

test('a transition from another mapped item onto the start item starts the show', async () => {
  // Walk PP off the start item (announcements — establishes the baseline)…
  srv.setActive(2, 'Announcements');
  await settle(350);
  assert.equal(sm.getState(ROOM).active, false, 'moving OFF the start item must not start');

  // …then onto it: the edge the loop is waiting for.
  srv.setActive(4, 'Praise');
  await waitFor(() => sm.getState(ROOM).active, 'autostart to begin the show');

  const st = sm.getState(ROOM);
  assert.equal(st.planId, plan.id);
  // pickAutostartTime chose a real (uncompleted) service time from the plan,
  // not the 'default' placeholder or the rehearsal.
  assert.ok(['svc-1', 'svc-2'].includes(st.timeId), `timeId "${st.timeId}" should be a service time`);
  assert.equal(st.follow, true);

  // The show's own poller talks to the same fake PP and maps the current item.
  await waitFor(() => sm.getState(ROOM).current.itemId === START.id, "the show poller to map PP's item");

  sm.endShow(ROOM);
  assert.equal(sm.getState(ROOM).active, false);
});

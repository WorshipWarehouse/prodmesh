import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-show-'));
process.env.PRODMESH_SHOW_POLL_MS = '30'; // PP poll: 800ms → 30ms
const sm = await import('./showManager.js');
const pco = await import('./integrations/planningCenter.js');
const timeline = await import('./timeline.js');
const conn = await import('./connectivity.js');
const showCfg = await import('./showConfig.js');
const { fakeProPresenter } = await import('./integrations/fakeProPresenter.js');

// north-youth has no proPresenter host → no live poller (test stays offline),
// and mock PC data supplies a plan + items.
const ROOM = 'north-youth';
const ST = { id: '500005', name: 'Youth Service' }; // must match the room's own service type

test('a show has a full lifecycle and records a timeline', async () => {
  const plan = (await pco.getUpcomingPlans(ST, 5))[0];
  const items = await pco.getPlanItems(ST, plan.id);
  const song = items.find((i) => i.type === 'song');

  // start
  let st = await sm.startShow(ROOM, plan.id, 't1');
  assert.equal(st.active, true);
  assert.equal(st.planId, plan.id);
  assert.equal(st.follow, true);

  // only one active show per room
  await assert.rejects(() => sm.startShow(ROOM, plan.id, 't1'), /already active/);

  // manual override drops follow and sets the current item
  st = sm.setCurrent(ROOM, { itemId: song.id });
  assert.equal(st.follow, false);
  assert.equal(st.current.itemId, song.id);

  // end
  st = sm.endShow(ROOM);
  assert.equal(st.active, false);

  // the transition was recorded and the instance is stamped complete
  const report = timeline.getReport(`${plan.id}__t1`);
  assert.ok(report.items.some((i) => i.itemName === song.title));
  assert.ok(report.completedAt != null);

  // reopening clears the completed stamp; ending again restores it
  await sm.startShow(ROOM, plan.id, 't1');
  assert.equal(timeline.getReport(`${plan.id}__t1`).completedAt, null);
  sm.endShow(ROOM);
  assert.ok(timeline.getReport(`${plan.id}__t1`).completedAt != null);
});

test('getState is inactive with no show; ending twice errors', () => {
  assert.deepEqual(sm.getState('north-chapel'), { active: false, timer: null, spl: null });
  assert.throws(() => sm.endShow('north-chapel'), /No active show/);
});

// A fake ProdMesh Remote RTA that reports a fixed SPL (see rta.test.js).
function fakeRta(slowDb) {
  const wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (ws) => {
    const frame = JSON.stringify({ type: 'levels', slow_db: slowDb, metrics: {} });
    ws.send(frame);
    const iv = setInterval(() => ws.send(frame), 50);
    ws.on('close', () => clearInterval(iv));
  });
  return { port: () => wss.address().port, close: () => new Promise((r) => wss.close(r)) };
}

async function waitFor(predicate, what, timeoutMs = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('auto-complete ignores PP’s stale last-slide flash when the end item is re-triggered', async () => {
  // Sunday 2026-07-26, second service: re-triggering the sermon completed the
  // show instantly, because PP briefly reports a re-triggered item's STORED
  // slide position — the last slide it showed in the FIRST service.
  const plan = (await pco.getUpcomingPlans(ST, 5))[0];
  const items = await pco.getPlanItems(ST, plan.id);
  const first = 0;
  const end = items.length - 1;
  showCfg.setConfig(ROOM, plan.id, { endItemId: items[end].id });
  const srv = await fakeProPresenter();
  try {
    srv.setActive(first, items[first].title);
    srv.setSlide(0);
    srv.setSlideCount(3);
    conn.setProPresenter(ROOM, { host: '127.0.0.1', port: srv.port() });
    await sm.startShow(ROOM, plan.id, 't2');
    await waitFor(() => sm.getState(ROOM).current?.itemId === items[first].id, 'the poller to map the opening item');

    // The op triggers the sermon → PP flashes its stored position: the last
    // slide (34 of 35) left over from the previous service.
    srv.setActive(end, items[end].title);
    srv.setSlide(34);
    srv.setSlideCount(35);
    await waitFor(() => sm.getState(ROOM).current?.itemId === items[end].id, 'the end item to map');
    await new Promise((r) => setTimeout(r, 150)); // several more poll cycles on the stale slide
    assert.equal(sm.getState(ROOM).active, true, 'a stale last-slide flash must not complete the show');

    // PP settles on the slide the op actually clicked → arms completion…
    srv.setSlide(0);
    await waitFor(() => sm.getState(ROOM).current?.slideIndex === 0, 'the real slide position');

    // …so reaching the genuine last slide completes the show.
    srv.setSlide(34);
    await waitFor(() => !sm.getState(ROOM).active, 'auto-complete on the genuine last slide');
    assert.ok(timeline.getReport(`${plan.id}__t2`).completedAt != null);
  } finally {
    if (sm.getState(ROOM).active) sm.endShow(ROOM);
    conn.setProPresenter(ROOM, null); // leave the shared room as this test found it
    await srv.close();
  }
});

test('a connectivity save restarts the SPL watcher with the new config', async () => {
  const srvA = fakeRta(85);
  const srvB = fakeRta(90);
  const res = { write: () => {} }; // fake SSE subscriber keeps the watcher wanted
  sm.subscribe(ROOM, res);
  try {
    // The room has no analysis source → no meter.
    assert.equal(sm.getState(ROOM).spl, null);

    // Saving a source starts a watcher without any re-subscribe.
    conn.setAnalysis(ROOM, { source: 'rta', host: '127.0.0.1', port: srvA.port() });
    await waitFor(() => sm.getState(ROOM).spl?.current === 85, 'samples from the first server');

    // Saving a different host moves the running watcher to it.
    conn.setAnalysis(ROOM, { source: 'rta', host: '127.0.0.1', port: srvB.port() });
    await waitFor(() => sm.getState(ROOM).spl?.current === 90, 'samples from the second server');

    // Clearing the source stops the watcher and the meter.
    conn.setAnalysis(ROOM, null);
    assert.equal(sm.getState(ROOM).spl, null);
  } finally {
    sm.unsubscribe(ROOM, res);
    conn.setAnalysis(ROOM, null); // leave the shared room as this test found it
    await srvA.close();
    await srvB.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-show-'));
const sm = await import('./showManager.js');
const pco = await import('./integrations/planningCenter.js');
const timeline = await import('./timeline.js');

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
  assert.deepEqual(sm.getState('north-chapel'), { active: false });
  assert.throws(() => sm.endShow('north-chapel'), /No active show/);
});

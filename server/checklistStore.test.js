import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-chk-'));
const chk = await import('./checklistStore.js');
const { templateFor } = await import('./checklists.config.js');

test('templateFor resolves event type, falls back to *, then []', () => {
  const sunday = templateFor('north-main', '500001');
  assert.ok(sunday.some((i) => i.action?.type === 'mode' && i.action.mode === 'sunday'));
  const other = templateFor('north-main', '500002'); // Second Service → '*'
  assert.ok(other.length > 0);
  assert.ok(!other.some((i) => i.action)); // fallback has no automated items
  assert.deepEqual(templateFor('north-youth', '500005'), []); // no templates yet
});

test('checklist state round-trips per event', () => {
  const list0 = chk.getChecklist('local-test', 'planA', '500001');
  assert.ok(list0.length >= 4);
  assert.ok(list0.every((i) => !i.done));

  chk.setItem('local-test', 'planA', 'cameras', true, 123456);
  const list1 = chk.getChecklist('local-test', 'planA', '500001');
  const cam = list1.find((i) => i.id === 'cameras');
  assert.equal(cam.done, true);
  assert.equal(cam.doneAt, 123456);

  // A different event (plan) is untouched — state is per-event.
  assert.ok(chk.getChecklist('local-test', 'planB', '500001').every((i) => !i.done));

  // Uncheck clears.
  chk.setItem('local-test', 'planA', 'cameras', false);
  assert.equal(chk.getChecklist('local-test', 'planA', '500001').find((i) => i.id === 'cameras').done, false);
});

test('unknown room/event type yields an empty checklist', () => {
  assert.deepEqual(chk.getChecklist('nope', 'p', 'x'), []);
});

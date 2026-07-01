import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-tl-'));
const tl = await import('./timeline.js');

const INST = 'plan1__t1';
const ctx = { roomId: 'r', planId: 'plan1', timeId: 't1' };

test('records durations, dedupes repeats, and computes deltas', () => {
  const at = (s) => s * 1000; // seconds → ms
  tl.recordActive(INST, ctx, { itemId: 'a', itemName: 'Welcome', plannedLength: 60 }, at(0));
  tl.recordActive(INST, ctx, { itemId: 'a', itemName: 'Welcome', plannedLength: 60 }, at(20)); // dupe → ignored
  tl.recordActive(INST, ctx, { itemId: 'b', itemName: 'Song', plannedLength: 300 }, at(60)); // A ran 60s
  tl.recordActive(INST, ctx, { itemId: 'c', itemName: 'Message', plannedLength: 1800 }, at(120)); // B ran 60s
  tl.recordActive(INST, ctx, null, at(130)); // null → ignored

  const r = tl.getReport(INST, at(180)); // C ongoing, ran 60s so far
  assert.equal(r.items.length, 3);

  const [a, b, c] = r.items;
  assert.equal(a.actualSeconds, 60);
  assert.equal(a.delta, 0); // 60 planned, 60 actual
  assert.equal(b.actualSeconds, 60);
  assert.equal(b.delta, -240); // 300 planned, 60 actual → under
  assert.equal(c.ongoing, true);
  assert.equal(c.actualSeconds, 60);

  assert.equal(r.totals.planned, 2160); // 60 + 300 + 1800
  assert.equal(r.totals.actual, 180);
  assert.equal(r.totals.delta, -1980);
});

test('getReport is null for an unknown instance', () => {
  assert.equal(tl.getReport('nope__x'), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-spl-'));
const spl = await import('./splStore.js');
const smaart = await import('./integrations/smaart.js');

test('leq is an energy average, not arithmetic', () => {
  // Constant level → Leq equals it.
  assert.ok(Math.abs(spl.leq([90, 90, 90]) - 90) < 1e-9);
  // Loud minutes dominate: 80 & 90 average well above the 85 midpoint.
  const v = spl.leq([80, 90]);
  assert.ok(v > 86.5 && v < 88, `got ${v}`);
  assert.equal(spl.leq([]), null);
});

test('samples round-trip through SQLite with correct aggregates', () => {
  const inst = 'plan1__t1';
  spl.record('room-a', inst, 1000, 85);
  spl.record('room-a', inst, 2000, 95);
  spl.record('room-a', inst, 3000, 90);
  const agg = spl.aggregate(inst);
  assert.equal(agg.count, 3);
  assert.equal(agg.peak, 95);
  assert.equal(agg.from, 1000);
  assert.equal(agg.to, 3000);
  assert.ok(agg.leq > 90 && agg.leq < 93, `leq ${agg.leq}`);
  assert.equal(spl.aggregate('nope__x'), null);
});

test('runningStats seeds continuation of a reopened show', () => {
  const inst = 'plan2__t1';
  spl.record('room-a', inst, 1, 88);
  spl.record('room-a', inst, 2, 92);
  const st = spl.runningStats(inst);
  assert.equal(st.n, 2);
  assert.equal(st.peak, 92);
  assert.ok(st.sumEnergy > 0);
  assert.deepEqual(spl.runningStats('fresh__t'), { n: 0, sumEnergy: 0, peak: null });
});

test('mock smaart meter emits plausible samples until aborted', async () => {
  const ctl = new AbortController();
  const samples = [];
  const run = smaart.watchSpl({ mock: true }, (s) => samples.push(s), ctl.signal, 5);
  await new Promise((r) => setTimeout(r, 60));
  ctl.abort();
  await run;
  assert.ok(samples.length >= 3, `got ${samples.length}`);
  for (const s of samples) {
    assert.ok(s.spl >= 76 && s.spl <= 98, `spl ${s.spl}`);
    assert.ok(Number.isFinite(s.ts));
  }
});

test('smaart isConfigured', () => {
  assert.equal(smaart.isConfigured(undefined), false);
  assert.equal(smaart.isConfigured({ mock: true }), true);
  assert.equal(smaart.isConfigured({ host: '10.0.0.5' }), true);
  assert.equal(smaart.isConfigured({}), false);
});

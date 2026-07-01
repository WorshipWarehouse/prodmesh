import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// No secrets in a throwaway dir → the module runs in mock mode.
process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-pco-'));
const pco = await import('./planningCenter.js');

const ST = { id: 'st-1', name: 'Weekend' };

test('isConfigured is false without credentials', () => {
  assert.equal(pco.isConfigured(), false);
});

test('getUpcomingPlans (mock) returns the requested count, normalized', async () => {
  const plans = await pco.getUpcomingPlans(ST, 2);
  assert.equal(plans.length, 2);
  for (const p of plans) {
    assert.equal(p.serviceTypeName, 'Weekend');
    assert.ok(p.title);
    assert.ok(Array.isArray(p.times) && p.times.length > 0);
    assert.ok(p.times[0].startsAt);
    assert.ok(p.sortDate);
  }
  // Ordered soonest-first.
  assert.ok(new Date(plans[0].sortDate) <= new Date(plans[1].sortDate));
});

test('getPlanItems (mock) returns a sequenced order of service', async () => {
  const items = await pco.getPlanItems(ST, 'plan-1');
  assert.ok(items.length > 0);
  assert.equal(items[0].sequence, 1);
  assert.ok(items.every((i) => typeof i.title === 'string'));
});

test('results are cached (same reference within TTL)', async () => {
  const a = await pco.getUpcomingPlans(ST, 3);
  const b = await pco.getUpcomingPlans(ST, 3);
  assert.equal(a, b);
  pco.clearCache();
  const c = await pco.getUpcomingPlans(ST, 3);
  assert.notEqual(a, c);
});

// First-run setup state on a FRESH install. setupUpgrade.test.js covers the
// other direction — an already-configured box must never see the wizard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-setup-'));
process.env.PRODMESH_SEED = 'empty'; // a real install: no demo campuses

const settings = await import('./settings.js');
const appConfig = await import('./appConfig.js');
const setup = await import('./setup.js'); // reconcile runs here — nothing to stamp

test('a fresh install wants the wizard', () => {
  assert.deepEqual(setup.getState(), {
    needed: true,
    completedAt: null,
    adminPinSet: false,
    hasCampus: false,
  });
});

test('a real install seeds no schedule for someone else\'s room', () => {
  // The example Sunday lock is keyed to "north-main". A church that has
  // never heard of North must not open Settings to a protection window on it.
  assert.deepEqual(settings.getPublicSettings().schedules, {});
});

test('setup stays needed while the wizard is mid-flight', () => {
  // The PIN is step one and the campus is step three, so an install that has
  // both is NOT evidence the wizard finished — inferring that would drop a
  // church into an empty app on reload.
  settings.setPins({ admin: 'admin1234' });
  assert.equal(setup.getState().adminPinSet, true);
  assert.equal(setup.getState().needed, true);

  appConfig.replaceChurch({
    name: 'Grace Community',
    sites: [{ id: 'main', name: 'Main Campus', status: 'active', auditoriums: [{ id: 'aud', name: 'Auditorium', tiles: [] }] }],
  });
  assert.equal(setup.getState().hasCampus, true);
  assert.equal(setup.getState().needed, true, 'only the wizard itself may end setup');
});

test('completing is a one-way door, and idempotent', () => {
  const first = setup.complete();
  assert.equal(first.needed, false);
  assert.ok(first.completedAt > 0);

  const again = setup.complete();
  assert.equal(again.completedAt, first.completedAt, 'the first stamp wins');
  assert.equal(setup.getState().needed, false);
});

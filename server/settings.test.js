import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the store at a throwaway dir BEFORE importing settings.
process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-settings-'));
const settings = await import('./settings.js');

test('PIN hashing verifies correct PINs and rejects wrong ones', () => {
  assert.equal(settings.isAdminSetupNeeded(), true);
  settings.setPins({ admin: 'admin1234', override: '9999' });
  assert.equal(settings.isAdminSetupNeeded(), false);
  assert.equal(settings.verifyAdmin('admin1234'), true);
  assert.equal(settings.verifyAdmin('0000'), false);
  assert.equal(settings.verifyOverride('9999'), true);
  assert.equal(settings.verifyOverride(''), false);
});

test('clearing the override PIN disables it', () => {
  settings.setPins({ override: '' });
  assert.equal(settings.isOverrideSet(), false);
  settings.setPins({ override: '4321' });
  assert.equal(settings.isOverrideSet(), true);
});

test('computeProtection is active only inside the window', () => {
  const now = new Date(2026, 6, 1, 9, 30); // fixed instant
  settings.setSchedules({
    r1: [{ id: 'w', label: 'Service', days: [now.getDay()], start: '09:00', end: '10:00', lock: ['standby'] }],
  });
  const inside = settings.computeProtection('r1', now);
  assert.equal(inside.active, true);
  assert.deepEqual(inside.lockedModes, ['standby']);
  assert.equal(inside.enforced, true); // override PIN is set

  const outside = settings.computeProtection('r1', new Date(2026, 6, 1, 11, 0));
  assert.equal(outside.active, false);
});

test('isModeLocked only locks listed modes during the window', () => {
  const now = new Date(2026, 6, 1, 9, 30);
  assert.equal(settings.isModeLocked('r1', 'standby', now), true);
  assert.equal(settings.isModeLocked('r1', 'sunday', now), false);
  assert.equal(settings.isModeLocked('r1', 'standby', new Date(2026, 6, 1, 11, 0)), false);
});

test('locks are not enforced without an override PIN', () => {
  settings.setPins({ override: '' });
  const now = new Date(2026, 6, 1, 9, 30);
  assert.equal(settings.computeProtection('r1', now).enforced, false);
  assert.equal(settings.isModeLocked('r1', 'standby', now), false);
});

test('sessions validate and expire on destroy', () => {
  const token = settings.createSession();
  assert.equal(settings.checkSession(token), true);
  assert.equal(settings.checkSession('nope'), false);
  settings.destroySession(token);
  assert.equal(settings.checkSession(token), false);
});

test('integrations are enabled by default and can be disabled individually', () => {
  assert.equal(settings.getIntegrationSettings().resi, true);
  assert.equal(settings.getIntegrationSettings().obs, true);
  const updated = settings.setIntegrationEnabled('resi', false);
  assert.equal(updated.resi, false);
  assert.equal(settings.getPublicSettings().integrations.resi, false);
  assert.throws(() => settings.setIntegrationEnabled('not-an-integration', false), /Unknown integration/);
});

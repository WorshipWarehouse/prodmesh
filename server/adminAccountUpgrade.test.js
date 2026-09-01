// The upgrade path for ADR 0012: an install that has an admin PIN and no
// `admin` account — which is every install that predates this — must find the
// account there after one restart, with the PIN nobody re-entered.
//
// Separate file because the projection runs when server/index.js is imported,
// and `node --test` gives each file its own process: arranging "settings.json
// already has a PIN BEFORE boot" is only possible before that import.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-admin-up-'));

const settings = await import('./settings.js');
settings.setPins({ admin: 'admin1234' }); // the old world: a hash in a file

const auth = await import('./authStore.js');
const before = auth.adminUser();

await import('./index.js'); // boot

test('an install with only a PIN gains the account at boot', () => {
  assert.equal(before, null, 'nothing had created it — this is the upgrade');
  const admin = auth.adminUser();
  assert.ok(admin, 'the account exists after boot');
  assert.equal(admin.username, 'admin');
  assert.equal(admin.display_name, 'System Administrator');
});

test('the PIN is carried across verbatim, so nobody re-enters anything', () => {
  // The hash itself moves, not the PIN — both sides have always used scrypt
  // with a 16-byte salt and a 32-byte key stored as `salt:hash` hex. That is
  // the whole reason this upgrade is silent rather than a reset email.
  assert.equal(auth.adminUser().pin_hash, settings.adminPinHash());

  const session = auth.authenticate('admin', 'admin1234');
  assert.ok(session, 'the PIN they already know still opens it');
  assert.deepEqual(session.permissions, ['*']);
});

test('the account tracks the file when the PIN changes', () => {
  settings.setPins({ admin: 'rotated789' });
  assert.equal(auth.adminUser().pin_hash, settings.adminPinHash());
  assert.equal(auth.authenticate('admin', 'admin1234'), null, 'the old PIN is gone');
  assert.ok(auth.authenticate('admin', 'rotated789'));
});

test('a rotated PIN takes the old sessions with it', () => {
  // Rotating is what somebody does when they think the PIN leaked, so the
  // session it opened must not outlive it by the rest of its eight hours.
  const open = auth.authenticate('admin', 'rotated789');
  assert.ok(auth.resolveSession(open.token));
  settings.setPins({ admin: 'rotated0000' });
  assert.equal(auth.resolveSession(open.token), null, 'signed out by the change');
});

test('clearing the PIN shuts the account rather than deleting it', () => {
  // An account the audit history points at should not evaporate — but shut
  // has to mean shut: authenticate and resolveSession both require active = 1.
  const open = auth.authenticate('admin', 'rotated0000');
  settings.setPins({ admin: '' });
  assert.ok(auth.adminUser(), 'still there');
  assert.equal(auth.adminUser().active, 0);
  assert.equal(auth.authenticate('admin', 'rotated0000'), null, 'the last PIN stops working');
  assert.equal(auth.resolveSession(open.token), null);
  assert.equal(settings.isAdminSetupNeeded(), true, 'and setup says so');

  // Setting one again reopens the same account, history intact.
  const id = auth.adminUser().id;
  settings.setPins({ admin: 'admin1234' });
  assert.equal(auth.adminUser().id, id);
  assert.ok(auth.authenticate('admin', 'admin1234'));
});

// The upgrade path: a box that was already running before the setup wizard
// existed must never be dropped into it. Grace Community's own install has a PIN
// and campuses and updates itself via update.sh, so the very first restart
// after this feature shipped would otherwise have opened first-run setup on a
// production server.
//
// Separate file because the check runs once, when setup.js is imported —
// `node --test` gives each file its own process, which is the only way to
// arrange "already configured BEFORE boot".
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-setup-up-'));
process.env.PRODMESH_SEED = 'demo'; // stands in for "this install has campuses"

const settings = await import('./settings.js');
settings.setPins({ admin: 'admin1234' }); // …and an admin

// Only now does the setup module load, so it sees a configured install at boot.
const setup = await import('./setup.js');

test('an install that already has a PIN and campuses is never shown the wizard', () => {
  const state = setup.getState();
  assert.equal(state.needed, false);
  assert.ok(state.completedAt > 0, 'stamped complete at boot');
  assert.equal(settings.getSetupCompletedAt(), state.completedAt, 'and persisted');
});

test('the demo seed keeps its example schedule', () => {
  // The inverse of the fresh-install case in setup.test.js: dev and test boxes
  // are built on this fixture, so the example lock must still be there.
  assert.ok(settings.getPublicSettings().schedules['north-main']);
});

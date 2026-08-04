import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate, SCHEMA_VERSION } from './db.js';

const tables = (d) =>
  d.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name);

test('a fresh database migrates to the current version with the full schema', () => {
  const d = new Database(':memory:');
  migrate(d);
  assert.equal(d.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  for (const t of ['spl_samples', 'sites', 'room_connectivity', 'users', 'audit_log', 'views', 'view_widgets']) {
    assert.ok(tables(d).includes(t), `expected table ${t}`);
  }
  // The ca column (a later migration) is present on a fresh install too.
  assert.ok(d.prepare(`SELECT 1 FROM pragma_table_info('spl_samples') WHERE name = 'ca'`).get());
});

test('migrate is a no-op at the current version', () => {
  const d = new Database(':memory:');
  migrate(d);
  migrate(d); // second run must not throw or change anything
  assert.equal(d.pragma('user_version', { simple: true }), SCHEMA_VERSION);
});

test('a pre-versioning database (full schema, user_version 0) upgrades cleanly', () => {
  // Production DBs from before versioning look exactly like this: every table
  // already exists but user_version was never set.
  const d = new Database(':memory:');
  migrate(d);
  d.pragma('user_version = 0');
  d.prepare(`INSERT INTO sites (id, name, status, position) VALUES ('x', 'X', 'coming-soon', 0)`).run();

  migrate(d);
  assert.equal(d.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  // The status repair (migration 2) ran over the legacy row.
  assert.equal(d.prepare(`SELECT status FROM sites WHERE id = 'x'`).get().status, 'disabled');
});

test('a database from a newer build is refused, not silently migrated', () => {
  const d = new Database(':memory:');
  migrate(d);
  d.pragma(`user_version = ${SCHEMA_VERSION + 5}`);
  assert.throws(() => migrate(d), /newer than this build/);
});

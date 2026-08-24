import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';

const DIR = mkdtempSync(join(tmpdir(), 'prodmesh-backup-'));
process.env.PRODMESH_DATA_DIR = DIR;

const { getDb, SCHEMA_VERSION } = await import('./db.js');
const backup = await import('./backup.js');

// Something in every category: a config table, a history table, a loose file,
// and a file in a subdirectory.
function seed() {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').run('church', 'Test Church');
  const spl = db.prepare('INSERT INTO spl_samples (room_id, instance_id, ts, spl, ca) VALUES (?,?,?,?,?)');
  db.transaction(() => { for (let i = 0; i < 2000; i += 1) spl.run('r1', 'inst', i, 85, null); })();
  writeFileSync(join(DIR, 'secrets.json'), JSON.stringify({ planningCenter: { token: 'pat-secret' } }));
  writeFileSync(join(DIR, 'settings.json'), JSON.stringify({ pins: { admin: 'hash' }, setupCompletedAt: 123 }));
  mkdirSync(join(DIR, 'branding'), { recursive: true });
  writeFileSync(join(DIR, 'branding', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  mkdirSync(join(DIR, 'timelines'), { recursive: true });
  writeFileSync(join(DIR, 'timelines', 'inst.json'), JSON.stringify({ items: [] }));
}
seed();

/** Restore into a scratch dir and open the database that lands there. */
function restoreInto(envelope) {
  const into = mkdtempSync(join(tmpdir(), 'prodmesh-restore-'));
  backup.restoreBackup(envelope, { dataDir: into });
  return { into, db: new Database(join(into, 'prodmesh.db'), { readonly: true }) };
}

test('a default backup round-trips the configuration and drops the history', () => {
  const env = backup.readBackup(backup.createBackup());
  assert.equal(env.prodmesh, 'backup');
  assert.equal(env.schema, SCHEMA_VERSION, 'stamped so a newer backup can be refused');
  assert.equal(env.history, false);

  const { into, db } = restoreInto(env);
  try {
    assert.equal(db.prepare('SELECT value FROM app_config WHERE key = ?').get('church').value, 'Test Church');
    // The 99% that is not worth carrying by default.
    assert.equal(db.prepare('SELECT COUNT(*) c FROM spl_samples').get().c, 0);
    // Secrets ride along, because a restore without them is not a restore —
    // the box comes back unable to reach Planning Center and nobody can log in.
    assert.match(readFileSync(join(into, 'secrets.json'), 'utf8'), /pat-secret/);
    assert.deepEqual([...readFileSync(join(into, 'branding', 'logo.png'))], [0x89, 0x50, 0x4e, 0x47]);
    // History files follow the same rule as history tables.
    assert.equal(existsSync(join(into, 'timelines', 'inst.json')), false);
  } finally {
    db.close();
  }
});

test('asking for history carries the samples and the timelines', () => {
  const env = backup.readBackup(backup.createBackup({ history: true }));
  assert.equal(env.history, true);
  const { into, db } = restoreInto(env);
  try {
    assert.equal(db.prepare('SELECT COUNT(*) c FROM spl_samples').get().c, 2000);
    assert.equal(existsSync(join(into, 'timelines', 'inst.json')), true);
  } finally {
    db.close();
  }
});

test('dropping the history actually shrinks the file', () => {
  // VACUUM after the DELETE, or the pages are freed and the backup is still
  // the same size — which would make the whole opt-in pointless.
  const small = backup.createBackup().length;
  const big = backup.createBackup({ history: true }).length;
  assert.ok(small < big, `expected the config-only backup to be smaller (${small} vs ${big})`);
});

test('the snapshot includes writes still sitting in the WAL', () => {
  // The reason for VACUUM INTO rather than copying prodmesh.db. A plain copy
  // silently omits recent commits, and a backup that fails silently is worse
  // than one that fails loudly.
  getDb().prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').run('fresh', 'just-written');
  const { db } = restoreInto(backup.readBackup(backup.createBackup()));
  try {
    assert.equal(db.prepare('SELECT value FROM app_config WHERE key = ?').get('fresh').value, 'just-written');
  } finally {
    db.close();
  }
});

test('a restore clears the sidecars rather than leaving a stale WAL', () => {
  // A -wal from the OLD database beside a restored .db is that database with
  // somebody else's newest transactions grafted on.
  const env = backup.readBackup(backup.createBackup());
  const into = mkdtempSync(join(tmpdir(), 'prodmesh-restore-'));
  writeFileSync(join(into, 'prodmesh.db-wal'), 'stale');
  writeFileSync(join(into, 'prodmesh.db-shm'), 'stale');
  backup.restoreBackup(env, { dataDir: into });
  assert.equal(existsSync(join(into, 'prodmesh.db-wal')), false);
  assert.equal(existsSync(join(into, 'prodmesh.db-shm')), false);
});

test('a backup from a NEWER prodmesh is refused, not half-applied', () => {
  // Migrations only run forward. Restoring a database whose schema is ahead of
  // this build leaves tables the code does not know about and columns it
  // expects to be missing.
  const env = backup.readBackup(backup.createBackup());
  const ahead = gzipSync(Buffer.from(JSON.stringify({ ...env, schema: SCHEMA_VERSION + 1 })));
  assert.throws(() => backup.readBackup(ahead), /newer prodmesh/);

  // An OLDER one is fine — migrations bring it forward on the next boot.
  const behind = gzipSync(Buffer.from(JSON.stringify({ ...env, schema: 1 })));
  assert.equal(backup.readBackup(behind).schema, 1);
});

test('anything that is not a backup is rejected with something readable', () => {
  for (const [bytes, why] of [
    [Buffer.from('not gzip at all'), /not a prodmesh backup, or it is damaged/],
    [gzipSync(Buffer.from('{"hello":true}')), /not a prodmesh backup/],
    [gzipSync(Buffer.from(JSON.stringify({ prodmesh: 'backup', format: 99 }))), /format 99/],
    [gzipSync(Buffer.from(JSON.stringify({ prodmesh: 'backup', format: 1 }))), /no database in it/],
  ]) {
    assert.throws(() => backup.readBackup(bytes), why);
  }
});

test('a crafted path in a backup cannot write outside the data directory', () => {
  // A backup is an uploaded file. Restore rebuilds every path from vetted
  // segments rather than trusting the key it was given.
  const env = backup.readBackup(backup.createBackup());
  const evil = {
    ...env,
    files: {
      '../../escaped.json': Buffer.from('nope').toString('base64'),
      'branding/../../escaped2.json': Buffer.from('nope').toString('base64'),
      '/etc/escaped3': Buffer.from('nope').toString('base64'),
      'settings.json': Buffer.from('{"kept":true}').toString('base64'),
    },
  };
  const into = mkdtempSync(join(tmpdir(), 'prodmesh-restore-'));
  backup.restoreBackup(evil, { dataDir: into });

  assert.equal(existsSync(join(into, '..', 'escaped.json')), false);
  assert.equal(existsSync(join(into, '..', 'escaped2.json')), false);
  assert.equal(existsSync('/etc/escaped3'), false);
  // The legitimate file beside them still lands.
  assert.match(readFileSync(join(into, 'settings.json'), 'utf8'), /kept/);
});

test('secrets.json comes back locked down, not world-readable', { skip: process.platform === 'win32' && 'no file modes' }, () => {
  // secrets.js writes this file 0600 and re-chmods it on every save, because
  // it is the Planning Center token and every integration credential in the
  // clear. Restoring it 0644 gives the rebuilt machine a weaker installation
  // than the one that was backed up, silently, until someone edits a secret.
  const env = backup.readBackup(backup.createBackup());
  const { into, db } = restoreInto(env);
  db.close();
  assert.equal(statSync(join(into, 'secrets.json')).mode & 0o777, 0o600);

  // And again over a file that already exists with a wider mode: a plain write
  // keeps whatever mode the file had.
  writeFileSync(join(into, 'secrets.json'), '{}');
  chmodSync(join(into, 'secrets.json'), 0o644);
  backup.restoreBackup(env, { dataDir: into });
  assert.equal(statSync(join(into, 'secrets.json')).mode & 0o777, 0o600);
});

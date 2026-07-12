// ─────────────────────────────────────────────────────────────────────────────
//  SQLITE  —  the store for facts & events (time-series, high write rates).
//
//  Per ADR 0006: config stays in human-inspectable JSON files; measurements
//  and event streams (SPL samples, future show reports/notes) live here.
//  Still just a file on the LAN box — zero ops, backup = copy the file.
//  WAL mode: writes don't block reads, and the single-writer process model
//  (ADR 0004) means no contention.
// ─────────────────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PRODMESH_DATA_DIR ?? join(__dirname, 'data');

let db = null;

export function getDb() {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(join(DATA_DIR, 'prodmesh.db'));
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS spl_samples (
      room_id     TEXT    NOT NULL,
      instance_id TEXT    NOT NULL, -- planId__timeId (same key as timelines)
      ts          INTEGER NOT NULL, -- ms since epoch
      spl         REAL    NOT NULL  -- dB SPL (A-weighted, slow)
    );
    CREATE INDEX IF NOT EXISTS spl_by_instance ON spl_samples (instance_id, ts);

    -- Startup checklist run state, per event (planId — per service, not per
    -- service time). Templates live in data/checklists.json; a row here means
    -- the item is done.
    CREATE TABLE IF NOT EXISTS checklist_state (
      room_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      done_at INTEGER NOT NULL,
      PRIMARY KEY (room_id, plan_id, item_id)
    );

    -- Per-event show automation config (set on the Event Detail page):
    -- which PC item autostarts the show, which one auto-completes it (at its
    -- last slide), and manual PC→PP mapping overrides. JSON blob; per event
    -- like checklist_state, and disposable with it.
    CREATE TABLE IF NOT EXISTS show_config (
      room_id    TEXT    NOT NULL,
      plan_id    TEXT    NOT NULL,
      config     TEXT    NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (room_id, plan_id)
    );

    -- Browser installation identity. The token is stored as a SHA-256 hash;
    -- the browser keeps the secret token. A station says WHERE an action came
    -- from, while a user session says WHO authorized it.
    CREATE TABLE IF NOT EXISTS stations (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      campus_id  TEXT,
      room_id    TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id                        TEXT PRIMARY KEY,
      username                  TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name              TEXT NOT NULL,
      pin_hash                  TEXT NOT NULL,
      planning_center_person_id TEXT,
      active                    INTEGER NOT NULL DEFAULT 1,
      created_at                INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permission_groups (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      system_key TEXT UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id          TEXT PRIMARY KEY,
      label       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS user_groups (
      user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS group_permissions (
      group_id      TEXT NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
      permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      station_id TEXT REFERENCES stations(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_by_expiry ON user_sessions (expires_at);

    CREATE TABLE IF NOT EXISTS audit_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ts            INTEGER NOT NULL,
      user_id       TEXT,
      station_id    TEXT,
      action        TEXT NOT NULL,
      resource_type TEXT,
      resource_id   TEXT,
      room_id       TEXT,
      plan_id       TEXT,
      result        TEXT NOT NULL,
      details       TEXT
    );
    CREATE INDEX IF NOT EXISTS audit_by_time ON audit_log (ts DESC);
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
//  SQLITE  —  authoritative runtime state and configuration.
//
//  Per ADR 0009: server-managed config and operational facts live here; JSON
//  is a portable import/export format rather than the live source of truth.
//  Still just a file on the LAN box — zero ops, with explicit backup planned.
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

    -- Institution topology (ADR 0009): what the frontend used to compile in as
    -- dashboard.config.ts. Seeded once from server/topologySeed.js, then owned
    -- by Admin → Campuses. Tiles keep per-type fields (host/url/username/…) in
    -- a validated JSON blob; the tree structure itself is relational.
    CREATE TABLE IF NOT EXISTS app_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sites (
      id       TEXT PRIMARY KEY,
      name     TEXT NOT NULL,
      status   TEXT NOT NULL DEFAULT 'active',
      position INTEGER NOT NULL
    );
    -- Early builds of this table used status 'coming-soon'; the model is now
    -- simply active/disabled.
    UPDATE sites SET status = 'disabled' WHERE status = 'coming-soon';

    CREATE TABLE IF NOT EXISTS site_rooms (
      id       TEXT PRIMARY KEY,
      site_id  TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      name     TEXT NOT NULL,
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tiles (
      id       TEXT PRIMARY KEY,
      room_id  TEXT NOT NULL REFERENCES site_rooms(id) ON DELETE CASCADE,
      type     TEXT NOT NULL,
      label    TEXT NOT NULL,
      note     TEXT,
      icon     TEXT,
      config   TEXT NOT NULL DEFAULT '{}',
      position INTEGER NOT NULL
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

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
  `);
}

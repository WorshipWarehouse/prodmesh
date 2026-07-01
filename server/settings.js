// ─────────────────────────────────────────────────────────────────────────────
//  SETTINGS STORE  —  operational settings that change at runtime.
//
//  Persisted to server/data/settings.json (git-ignored, per-box). Holds the
//  Admin/Override PINs (hashed) and per-room lockout schedules. Structural
//  config (rooms, Companion hosts, button locations) stays in rooms.config.js.
//
//  This is the tier-2 store the Settings UI edits — no dependencies, just a file.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateSchedules } from './validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Overridable so tests (and alternate deployments) can point at their own dir.
const DATA_DIR = process.env.PRODMESH_DATA_DIR ?? join(__dirname, 'data');
const FILE = join(DATA_DIR, 'settings.json');

// First-run defaults. A Sunday lock on the Auditorium is pre-seeded as an
// example (it only takes effect once an Override PIN is set).
const DEFAULTS = {
  version: 1,
  pins: { admin: null, override: null }, // hashed "salt:hash" strings, or null
  schedules: {
    'north-main': [
      {
        id: 'sun-services',
        label: 'Sunday Services',
        days: [0], // 0 = Sunday
        start: '07:00',
        end: '13:30',
        lock: ['standby'], // mode ids that require the Override PIN in this window
      },
    ],
  },
};

let settings = null;

function load() {
  if (settings) return settings;
  if (existsSync(FILE)) {
    try {
      settings = { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, 'utf8')) };
    } catch {
      settings = structuredClone(DEFAULTS);
    }
  } else {
    settings = structuredClone(DEFAULTS);
    persist();
  }
  return settings;
}

function persist() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(settings, null, 2));
}

// ── PIN hashing (scrypt, salted, constant-time compare) ───────────────────────
function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(pin), salt, 32);
  return `${salt.toString('hex')}:${dk.toString('hex')}`;
}

function verifyHash(pin, stored) {
  if (!stored || pin == null || pin === '') return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const dk = crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 32);
  const hb = Buffer.from(hashHex, 'hex');
  return dk.length === hb.length && crypto.timingSafeEqual(dk, hb);
}

export const verifyAdmin = (pin) => verifyHash(pin, load().pins.admin);
export const verifyOverride = (pin) => verifyHash(pin, load().pins.override);
export const isAdminSetupNeeded = () => load().pins.admin == null;
export const isOverrideSet = () => load().pins.override != null;

/**
 * Update PINs. For each of `admin` / `override`:
 *   - a non-empty string sets it
 *   - the empty string '' clears it (null)
 *   - undefined leaves it unchanged
 */
export function setPins({ admin, override } = {}) {
  const s = load();
  if (admin !== undefined) s.pins.admin = admin === '' ? null : hashPin(admin);
  if (override !== undefined) s.pins.override = override === '' ? null : hashPin(override);
  persist();
}

export function setSchedules(schedules) {
  const s = load();
  s.schedules = validateSchedules(schedules);
  persist();
}

// ── Public (safe) view for the Settings UI — never exposes hashes ─────────────
export function getPublicSettings() {
  const s = load();
  return {
    pins: { adminSet: s.pins.admin != null, overrideSet: s.pins.override != null },
    schedules: s.schedules,
  };
}

// ── Lockout engine ────────────────────────────────────────────────────────────
/**
 * Which protection (if any) applies to a room right now.
 * `enforced` is true only when an Override PIN exists — locks are meaningless
 * without a PIN to override them, so we don't advertise them until one is set.
 */
export function computeProtection(roomId, now = new Date()) {
  const windows = load().schedules[roomId] ?? [];
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const w of windows) {
    if (!Array.isArray(w.days) || !w.days.includes(day)) continue;
    const [sh, sm] = String(w.start).split(':').map(Number);
    const [eh, em] = String(w.end).split(':').map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (minutes >= start && minutes < end) {
      return {
        active: true,
        label: w.label,
        lockedModes: w.lock ?? [],
        enforced: isOverrideSet(),
      };
    }
  }
  return { active: false, label: null, lockedModes: [], enforced: isOverrideSet() };
}

/** Does switching to `modeId` require the Override PIN right now? */
export function isModeLocked(roomId, modeId, now = new Date()) {
  const p = computeProtection(roomId, now);
  return p.active && p.enforced && p.lockedModes.includes(modeId);
}

// ── Sessions (in-memory bearer tokens for the admin) ──────────────────────────
const sessions = new Map(); // token → expiresAt (ms)
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

export function checkSession(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export const destroySession = (token) => sessions.delete(token);

// ── App version (current git commit) ──────────────────────────────────────────
export function getVersion() {
  try {
    const root = join(__dirname, '..');
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim();
    const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: root }).toString().trim();
    return { commit, subject };
  } catch {
    return { commit: 'unknown', subject: '' };
  }
}

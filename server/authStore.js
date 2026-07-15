import crypto from 'node:crypto';
import { getDb } from './db.js';

export const PERMISSIONS = [
  ['checklists.complete', 'Complete checklist items', 'Check or reopen startup checklist items.'],
  ['checklists.templates.edit', 'Edit checklist templates', 'Create and change checklist templates.'],
  ['rooms.mode.change', 'Change room modes', 'Change the active production mode for a room.'],
  ['rooms.mode.override_lock', 'Override protected modes', 'Bypass a scheduled room-mode lockout.'],
  ['shows.operate', 'Operate shows', 'Start, end, and manually follow a show.'],
  ['shows.configure', 'Configure show automation', 'Edit ProPresenter mappings and automation.'],
  ['reports.view', 'View reports', 'View completed show reports and analytics.'],
  ['settings.manage', 'Manage settings', 'Edit operational settings and schedules.'],
  ['users.manage', 'Manage users', 'Create users and assign permission groups.'],
  ['stations.manage', 'Manage stations', 'Rename, assign, and revoke registered browser stations.'],
  ['system.update', 'Run system updates', 'Install a prodmesh system update.'],
  ['system.logs', 'View logs', 'Read the server process log and the audit trail.'],
];

const SESSION_TTL = 8 * 60 * 60 * 1000;

const id = () => crypto.randomUUID();
const digest = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const normalizePcPersonId = (value) => String(value ?? '').trim().replace(/^P(?=\d+$)/i, '');

function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPin(pin, stored) {
  if (!pin || !stored) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const actual = crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function initialize() {
  const db = getDb();
  const now = Date.now();
  const seedPermission = db.prepare(
    'INSERT INTO permissions (id, label, description) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET label=excluded.label, description=excluded.description',
  );
  const seed = db.transaction(() => {
    for (const p of PERMISSIONS) seedPermission.run(...p);
    db.prepare(
      `INSERT INTO permission_groups (id, name, system_key, created_at)
       VALUES ('group-admin', 'Administrators', 'admin', ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(now);
  });
  seed();
}

export function registerStation({ name, campusId = null, roomId = null }) {
  const clean = String(name ?? '').trim();
  if (clean.length < 2 || clean.length > 80) throw new Error('Station name must be 2–80 characters');
  const stationId = id();
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  getDb().prepare(
    'INSERT INTO stations (id, name, campus_id, room_id, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(stationId, clean, campusId, roomId, digest(token), now, now);
  return { id: stationId, name: clean, campusId, roomId, token };
}

export function resolveStation(token) {
  if (!token) return null;
  const row = getDb().prepare(
    'SELECT id, name, campus_id AS campusId, room_id AS roomId FROM stations WHERE token_hash = ?',
  ).get(digest(token));
  if (row) getDb().prepare('UPDATE stations SET last_seen = ? WHERE id = ?').run(Date.now(), row.id);
  return row ?? null;
}

export function listStations() {
  return getDb().prepare(
    `SELECT id, name, campus_id AS campusId, room_id AS roomId,
            created_at AS createdAt, last_seen AS lastSeen
       FROM stations ORDER BY name COLLATE NOCASE`,
  ).all();
}

export function updateStation(stationId, { name, campusId = null, roomId = null }) {
  const clean = String(name ?? '').trim();
  if (clean.length < 2 || clean.length > 80) throw new Error('Station name must be 2–80 characters');
  const result = getDb().prepare(
    'UPDATE stations SET name = ?, campus_id = ?, room_id = ? WHERE id = ?',
  ).run(clean, campusId || null, roomId || null, stationId);
  if (!result.changes) throw new Error('Unknown station');
  return listStations().find((station) => station.id === stationId);
}

export function revokeStation(stationId) {
  const db = getDb();
  const station = listStations().find((entry) => entry.id === stationId);
  if (!station) throw new Error('Unknown station');
  db.transaction(() => {
    db.prepare('DELETE FROM user_sessions WHERE station_id = ?').run(stationId);
    db.prepare('DELETE FROM stations WHERE id = ?').run(stationId);
  })();
  return station;
}

function permissionsFor(userId) {
  const rows = getDb().prepare(
    `SELECT pg.system_key AS systemKey, gp.permission_id AS permission
       FROM user_groups ug
       JOIN permission_groups pg ON pg.id = ug.group_id
       LEFT JOIN group_permissions gp ON gp.group_id = pg.id
      WHERE ug.user_id = ?`,
  ).all(userId);
  if (rows.some((r) => r.systemKey === 'admin')) return ['*'];
  return [...new Set(rows.map((r) => r.permission).filter(Boolean))].sort();
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name ?? row.displayName,
    planningCenterPersonId: row.planning_center_person_id ?? row.planningCenterPersonId ?? null,
  };
}

export function authenticate(username, pin, stationId = null) {
  const row = getDb().prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND active = 1').get(String(username ?? '').trim());
  if (!row || !verifyPin(pin, row.pin_hash)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  getDb().prepare(
    'INSERT INTO user_sessions (token_hash, user_id, station_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(digest(token), row.id, stationId, now, now + SESSION_TTL);
  return { token, user: publicUser(row), permissions: permissionsFor(row.id) };
}

export function resolveSession(token) {
  if (!token) return null;
  const row = getDb().prepare(
    `SELECT s.expires_at, u.* FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND u.active = 1`,
  ).get(digest(token));
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    getDb().prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(digest(token));
    return null;
  }
  return { user: publicUser(row), permissions: permissionsFor(row.id) };
}

export function destroySession(token) {
  if (token) getDb().prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(digest(token));
}

export function hasPermission(session, permission) {
  return Boolean(session?.permissions?.includes('*') || session?.permissions?.includes(permission));
}

export function createUser({ username, displayName, pin, planningCenterPersonId = null, groupIds = [] }) {
  const uname = String(username ?? '').trim();
  const display = String(displayName ?? '').trim();
  const pcPersonId = normalizePcPersonId(planningCenterPersonId);
  if (!/^[a-z0-9._-]{2,40}$/i.test(uname)) throw new Error('Username must be 2–40 letters, numbers, dots, dashes, or underscores');
  if (display.length < 2 || display.length > 80) throw new Error('Display name must be 2–80 characters');
  if (String(pin ?? '').length < 4) throw new Error('PIN must be at least 4 characters');
  if (pcPersonId && !/^\d+$/.test(pcPersonId)) throw new Error('Planning Center person ID must be numeric');
  const userId = id();
  const db = getDb();
  const duplicatePcUser = pcPersonId
    ? db.prepare('SELECT username, planning_center_person_id AS personId FROM users WHERE planning_center_person_id IS NOT NULL').all()
      .find((row) => normalizePcPersonId(row.personId) === pcPersonId)
    : null;
  if (duplicatePcUser) throw new Error(`Planning Center person is already assigned to @${duplicatePcUser.username}`);
  db.transaction(() => {
    db.prepare(
      'INSERT INTO users (id, username, display_name, pin_hash, planning_center_person_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(userId, uname, display, hashPin(pin), pcPersonId || null, Date.now());
    const add = db.prepare('INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)');
    for (const groupId of groupIds) add.run(userId, groupId);
  })();
  return getUser(userId);
}

export function getUser(userId) {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!row) return null;
  const groups = getDb().prepare(
    `SELECT pg.id, pg.name, pg.system_key AS systemKey FROM user_groups ug
      JOIN permission_groups pg ON pg.id = ug.group_id WHERE ug.user_id = ? ORDER BY pg.name`,
  ).all(userId);
  return { ...publicUser(row), active: Boolean(row.active), groups, permissions: permissionsFor(userId) };
}

export function listDirectory() {
  const db = getDb();
  const users = db.prepare('SELECT id FROM users ORDER BY display_name').all().map((r) => getUser(r.id));
  const groups = db.prepare('SELECT id, name, system_key AS systemKey FROM permission_groups ORDER BY name').all().map((group) => ({
    ...group,
    permissions: group.systemKey === 'admin'
      ? ['*']
      : db.prepare('SELECT permission_id FROM group_permissions WHERE group_id = ? ORDER BY permission_id').all(group.id).map((r) => r.permission_id),
  }));
  const permissions = db.prepare('SELECT id, label, description FROM permissions ORDER BY id').all();
  return { users, groups, permissions };
}

export function createGroup({ name, permissions = [] }) {
  const clean = String(name ?? '').trim();
  if (clean.length < 2 || clean.length > 60) throw new Error('Group name must be 2–60 characters');
  const allowed = new Set(PERMISSIONS.map(([permission]) => permission));
  if (!permissions.every((permission) => allowed.has(permission))) throw new Error('Unknown permission');
  const groupId = id();
  const db = getDb();
  db.transaction(() => {
    db.prepare('INSERT INTO permission_groups (id, name, created_at) VALUES (?, ?, ?)').run(groupId, clean, Date.now());
    const add = db.prepare('INSERT INTO group_permissions (group_id, permission_id) VALUES (?, ?)');
    for (const permission of permissions) add.run(groupId, permission);
  })();
  return listDirectory().groups.find((group) => group.id === groupId);
}

export function updateUserGroups(userId, groupIds) {
  const db = getDb();
  if (!getUser(userId)) throw new Error('Unknown user');
  db.transaction(() => {
    db.prepare('DELETE FROM user_groups WHERE user_id = ?').run(userId);
    const add = db.prepare('INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)');
    for (const groupId of groupIds ?? []) add.run(userId, groupId);
  })();
  return getUser(userId);
}

export function listAudit(limit = 200) {
  const n = Math.max(1, Math.min(500, Number(limit) || 200));
  return getDb().prepare(
    `SELECT a.id, a.ts, a.action, a.resource_type AS resourceType, a.resource_id AS resourceId,
            a.room_id AS roomId, a.plan_id AS planId, a.result, a.details,
            u.display_name AS userName, u.username, s.name AS stationName
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN stations s ON s.id = a.station_id
      ORDER BY a.ts DESC, a.id DESC LIMIT ?`,
  ).all(n).map((row) => ({ ...row, details: row.details ? JSON.parse(row.details) : null }));
}

export function audit({ userId = null, stationId = null, action, resourceType = null, resourceId = null, roomId = null, planId = null, result, details = null }) {
  getDb().prepare(
    `INSERT INTO audit_log (ts, user_id, station_id, action, resource_type, resource_id, room_id, plan_id, result, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(Date.now(), userId, stationId, action, resourceType, resourceId, roomId, planId, result, details ? JSON.stringify(details) : null);
}

initialize();

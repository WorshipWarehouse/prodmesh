// Wireless inventory and per-service assignments. This store owns planning
// data only; receiver telemetry is intentionally a future reader of this data,
// never a prerequisite for giving a volunteer the right pack before rehearsal.

import crypto from 'node:crypto';
import { getDb } from './db.js';

const KINDS = new Set(['microphone', 'pack']);
const CONNECTIONS = new Set(['wired', 'wireless']);
const STATUSES = new Set(['ready', 'service', 'repair', 'retired']);
const clean = (value, max = 100) => String(value ?? '').trim().slice(0, max);

function gearRow(row) {
  return row && {
    id: row.id, roomId: row.room_id, kind: row.kind, vendor: row.vendor,
    model: row.model, label: row.label, channel: row.channel ?? '', connection: row.connection ?? 'wireless',
    receiverHost: row.receiver_host ?? '', receiverPort: row.receiver_port ?? null,
    status: row.status, notes: row.notes ?? '', updatedAt: row.updated_at,
  };
}

export function listGear(roomId) {
  return getDb().prepare(
    'SELECT * FROM wireless_gear WHERE room_id = ? ORDER BY kind, label COLLATE NOCASE',
  ).all(roomId).map(gearRow);
}

export function createGear(roomId, input) {
  const kind = clean(input.kind, 20);
  const vendor = clean(input.vendor || 'Generic', 60);
  const model = clean(input.model, 100);
  const label = clean(input.label, 80);
  const channel = clean(input.channel, 40);
  const connection = clean(input.connection || 'wireless', 20);
  const receiverHost = clean(input.receiverHost, 255);
  const receiverPort = input.receiverPort == null || input.receiverPort === '' ? null : Number(input.receiverPort);
  const status = clean(input.status || 'ready', 20);
  const notes = clean(input.notes, 300);
  if (!KINDS.has(kind)) throw new Error('Choose microphone or pack');
  if (!model) throw new Error('A gear model is required');
  if (!label) throw new Error('A gear label is required');
  if (!STATUSES.has(status)) throw new Error('Unknown gear status');
  if (!CONNECTIONS.has(connection)) throw new Error('Unknown microphone connection type');
  if (receiverPort != null && (!Number.isInteger(receiverPort) || receiverPort < 1 || receiverPort > 65535)) throw new Error('Receiver port must be 1–65535');
  const now = Date.now();
  const id = crypto.randomUUID();
  getDb().prepare(
    `INSERT INTO wireless_gear (id, room_id, kind, vendor, model, label, channel, connection, receiver_host, receiver_port, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, roomId, kind, vendor, model, label, channel || null, connection, receiverHost || null, receiverPort, status, notes || null, now, now);
  return listGear(roomId).find((item) => item.id === id);
}

export function updateGear(roomId, gearId, input) {
  const current = getDb().prepare('SELECT * FROM wireless_gear WHERE id = ? AND room_id = ?').get(gearId, roomId);
  if (!current) throw new Error('Unknown wireless gear');
  const next = {
    vendor: input.vendor === undefined ? current.vendor : clean(input.vendor || 'Generic', 60),
    model: input.model === undefined ? current.model : clean(input.model, 100),
    label: input.label === undefined ? current.label : clean(input.label, 80),
    channel: input.channel === undefined ? (current.channel ?? '') : clean(input.channel, 40),
    connection: input.connection === undefined ? (current.connection ?? 'wireless') : clean(input.connection, 20),
    receiverHost: input.receiverHost === undefined ? (current.receiver_host ?? '') : clean(input.receiverHost, 255),
    receiverPort: input.receiverPort === undefined ? current.receiver_port : (input.receiverPort === '' || input.receiverPort == null ? null : Number(input.receiverPort)),
    status: input.status === undefined ? current.status : clean(input.status, 20),
    notes: input.notes === undefined ? (current.notes ?? '') : clean(input.notes, 300),
  };
  if (!next.model || !next.label) throw new Error('Model and label are required');
  if (!STATUSES.has(next.status)) throw new Error('Unknown gear status');
  if (!CONNECTIONS.has(next.connection)) throw new Error('Unknown microphone connection type');
  if (next.receiverPort != null && (!Number.isInteger(next.receiverPort) || next.receiverPort < 1 || next.receiverPort > 65535)) throw new Error('Receiver port must be 1–65535');
  getDb().prepare(
    `UPDATE wireless_gear SET vendor = ?, model = ?, label = ?, channel = ?, connection = ?, receiver_host = ?, receiver_port = ?, status = ?, notes = ?, updated_at = ?
      WHERE id = ? AND room_id = ?`,
  ).run(next.vendor, next.model, next.label, next.channel || null, next.connection, next.receiverHost || null, next.receiverPort, next.status, next.notes || null, Date.now(), gearId, roomId);
  return listGear(roomId).find((item) => item.id === gearId);
}

export function removeGear(roomId, gearId) {
  const db = getDb();
  const used = db.prepare('SELECT 1 FROM wireless_assignments WHERE gear_id = ? LIMIT 1').get(gearId);
  if (used) throw new Error('Unassign this gear from services before removing it');
  const result = db.prepare('DELETE FROM wireless_gear WHERE id = ? AND room_id = ?').run(gearId, roomId);
  if (!result.changes) throw new Error('Unknown wireless gear');
}

export function assignmentsForPlan(roomId, planId) {
  return getDb().prepare(
    `SELECT a.team_member_id AS teamMemberId, a.slot, a.gear_id AS gearId,
            g.id, g.kind, g.vendor, g.model, g.label, g.channel, g.connection, g.receiver_host, g.receiver_port, g.status, g.notes, g.updated_at
       FROM wireless_assignments a JOIN wireless_gear g ON g.id = a.gear_id
      WHERE a.room_id = ? AND a.plan_id = ?`,
  ).all(roomId, planId).map((row) => ({ teamMemberId: row.teamMemberId, slot: row.slot, gear: gearRow({ ...row, room_id: roomId }) }));
}

export function setAssignment(roomId, planId, teamMemberId, slot, gearId, updatedBy = null) {
  if (!KINDS.has(slot)) throw new Error('Unknown assignment slot');
  const db = getDb();
  if (!gearId) {
    db.prepare('DELETE FROM wireless_assignments WHERE room_id = ? AND plan_id = ? AND team_member_id = ? AND slot = ?')
      .run(roomId, planId, teamMemberId, slot);
    return null;
  }
  const gear = db.prepare('SELECT * FROM wireless_gear WHERE id = ? AND room_id = ?').get(gearId, roomId);
  if (!gear) throw new Error('That gear does not belong to this room');
  if (gear.kind !== slot) throw new Error(`That ${gear.kind} cannot fill a ${slot} assignment`);
  if (gear.status === 'retired') throw new Error('Retired gear cannot be assigned');
  const now = Date.now();
  db.prepare(
    `INSERT INTO wireless_assignments (room_id, plan_id, team_member_id, slot, gear_id, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(room_id, plan_id, team_member_id, slot)
     DO UPDATE SET gear_id = excluded.gear_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).run(roomId, planId, teamMemberId, slot, gearId, updatedBy, now);
  return gearRow(gear);
}

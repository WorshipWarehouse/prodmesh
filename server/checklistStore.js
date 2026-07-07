// ─────────────────────────────────────────────────────────────────────────────
//  CHECKLIST STORE  —  merges an event-type template with per-event state.
//
//  State is keyed by (roomId, planId): one checklist run per EVENT, shared by
//  every service time and every browser (server-authoritative, like shows).
// ─────────────────────────────────────────────────────────────────────────────

import { getDb } from './db.js';
import { templateFor } from './checklistTemplates.js';

/** Template + done-state → the checklist as the UI sees it. */
export function getChecklist(roomId, planId, serviceTypeId) {
  const tpl = templateFor(serviceTypeId);
  if (tpl.length === 0) return [];
  const rows = getDb()
    .prepare('SELECT item_id, done_at FROM checklist_state WHERE room_id = ? AND plan_id = ?')
    .all(roomId, planId);
  const doneAt = new Map(rows.map((r) => [r.item_id, r.done_at]));
  return tpl.map((it) => ({
    id: it.id,
    label: it.label,
    action: it.action ?? null,
    done: doneAt.has(it.id),
    doneAt: doneAt.get(it.id) ?? null,
  }));
}

export function setItem(roomId, planId, itemId, done, nowMs = Date.now()) {
  const db = getDb();
  if (done) {
    db.prepare(
      `INSERT INTO checklist_state (room_id, plan_id, item_id, done_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (room_id, plan_id, item_id) DO UPDATE SET done_at = excluded.done_at`,
    ).run(roomId, planId, itemId, nowMs);
  } else {
    db.prepare('DELETE FROM checklist_state WHERE room_id = ? AND plan_id = ? AND item_id = ?').run(
      roomId,
      planId,
      itemId,
    );
  }
}

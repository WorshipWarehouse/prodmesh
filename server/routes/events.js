// Planning Center plans, event detail, show config, checklists, and reports.

import express from 'express';

import { rooms } from '../roomsStore.js';
import * as pco from '../integrations/planningCenter.js';
import * as timeline from '../timeline.js';
import * as show from '../showManager.js';
import * as splStore from '../splStore.js';
import * as checklist from '../checklistStore.js';
import * as chkTemplates from '../checklistTemplates.js';
import * as showCfg from '../showConfig.js';
import * as ppro from '../integrations/proPresenter.js';
import * as auth from '../authStore.js';
import { requirePermission, auditSuccess } from '../httpAuth.js';
import { applyMode, modeLockError } from '../roomModes.js';

const router = express.Router();

// ── Planning Center Services (read-only plan display) ──────────────────────────

const stOf = (plan) => ({ id: plan.serviceTypeId, name: plan.serviceTypeName });

// Upcoming plans across ALL of a room's service types, soonest first.
async function upcomingForRoom(pc, limit) {
  const types = pc.serviceTypes ?? [];
  const lists = await Promise.all(
    types.map((st) => pco.getUpcomingPlans(st, limit).catch(() => [])),
  );
  return lists
    .flat()
    .sort((a, b) => new Date(a.sortDate) - new Date(b.sortDate))
    .slice(0, limit);
}

// Overview: next service per configured room (for Quick Access). Rooms are
// fetched in parallel (Promise.all keeps map order) so a slow Planning Center
// costs one room's latency, not rooms × timeout.
router.get('/api/services', async (_req, res) => {
  const configured = Object.values(rooms).filter((room) => room.planningCenter?.serviceTypes?.length);
  const out = await Promise.all(
    configured.map(async (room) => {
      try {
        const [next] = await upcomingForRoom(room.planningCenter, 1);
        if (next) next.times = await pco.getPlanTimes(stOf(next), next.id);
        return { roomId: room.id, roomName: room.name, serviceType: next?.serviceTypeName ?? null, next: next ?? null };
      } catch (err) {
        return { roomId: room.id, roomName: room.name, serviceType: null, next: null, error: String(err.message ?? err) };
      }
    }),
  );
  res.json({ live: pco.isConfigured(), services: out });
});

// A specific plan for a room, fully hydrated (times + order of service).
// Used by the Run of Show view.
router.get('/api/rooms/:id/plan/:planId', async (req, res) => {
  const room = rooms[req.params.id];
  if (!room?.planningCenter?.serviceTypes?.length) {
    return res.status(404).json({ error: 'No plans for this room' });
  }
  try {
    const plan = (await upcomingForRoom(room.planningCenter, 10)).find((p) => p.id === req.params.planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const st = stOf(plan);
    [plan.times, plan.items] = await Promise.all([
      pco.getPlanTimes(st, plan.id),
      pco.getPlanItems(st, plan.id),
    ]);
    res.json({ live: pco.isConfigured(), plan });
  } catch (err) {
    res.status(502).json({ error: String(err.message ?? err) });
  }
});

// ── Event Detail (the page above Run of Show: times, notes, checklist) ────────

// Resolve one of the room's upcoming plans by id (shared lookup).
async function planForRoom(room, planId) {
  if (!room?.planningCenter?.serviceTypes?.length) return null;
  return (await upcomingForRoom(room.planningCenter, 10)).find((p) => p.id === planId) ?? null;
}

router.get('/api/rooms/:id/event/:planId', async (req, res) => {
  const room = rooms[req.params.id];
  if (!room) return res.status(404).json({ error: 'Unknown room' });
  try {
    const plan = await planForRoom(room, req.params.planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const st = stOf(plan);
    // Items feed the Show Automation widget (start/end pickers + mapping).
    const [times, detail, items] = await Promise.all([
      pco.getPlanTimes(st, plan.id),
      pco.getPlanDetail(st, plan.id),
      pco.getPlanItems(st, plan.id).catch(() => []),
    ]);
    plan.times = times;
    plan.items = items;
    res.json({
      live: pco.isConfigured(),
      plan,
      detail,
      checklist: checklist.getChecklist(room.id, plan.id, plan.serviceTypeId),
      showConfig: showCfg.getConfig(room.id, plan.id),
    });
  } catch (err) {
    res.status(502).json({ error: String(err.message ?? err) });
  }
});

// ── Show automation config (Event Detail → Show Config widget) ───────────────

router.put('/api/rooms/:id/event/:planId/show-config', requirePermission('shows.configure'), (req, res) => {
  if (!rooms[req.params.id]) return res.status(404).json({ error: 'Unknown room' });
  try {
    const config = showCfg.setConfig(req.params.id, req.params.planId, req.body ?? {});
    show.refreshConfig(req.params.id, req.params.planId); // live show picks it up
    res.json({ ok: true, showConfig: config });
  } catch (err) {
    res.status(400).json({ error: String(err.message ?? err) });
  }
});

router.delete('/api/rooms/:id/event/:planId/show-config', requirePermission('shows.configure'), (req, res) => {
  if (!rooms[req.params.id]) return res.status(404).json({ error: 'Unknown room' });
  showCfg.clearConfig(req.params.id, req.params.planId);
  show.refreshConfig(req.params.id, req.params.planId);
  res.json({ ok: true, showConfig: null });
});

// The ProPresenter playlist to map THIS event against (for the mapping UI):
// prefers the playlist whose pushed name matches the plan; falls back to
// whatever's active in PP (matched: false → the UI warns it's a different
// service's playlist).
router.get('/api/rooms/:id/event/:planId/pp-playlist', async (req, res) => {
  const room = rooms[req.params.id];
  if (!room) return res.status(404).json({ error: 'Unknown room' });
  if (!ppro.isConfigured(room.proPresenter)) return res.json({ playlist: null });
  try {
    const plan = await planForRoom(room, req.params.planId).catch(() => null);
    res.json({ playlist: await ppro.readPlaylistItems(room.proPresenter, undefined, plan) });
  } catch {
    res.json({ playlist: null }); // PP offline — the UI explains itself
  }
});

// ── Checklist templates (per event type, edited in Admin → Checklists) ───────

// Templates plus what the editor needs to offer: the event types known from
// room mappings, and the union of mode ids for the automated-item picker.
router.get('/api/checklist-templates', (_req, res) => {
  const serviceTypes = new Map();
  const modes = new Map();
  for (const room of Object.values(rooms)) {
    for (const st of room.planningCenter?.serviceTypes ?? []) serviceTypes.set(st.id, st.name);
    for (const m of room.modes) if (!modes.has(m.id)) modes.set(m.id, m.label);
  }
  res.json({
    templates: chkTemplates.getTemplates(),
    serviceTypes: [...serviceTypes].map(([id, name]) => ({ id, name })),
    modes: [...modes].map(([id, label]) => ({ id, label })),
  });
});

router.put('/api/checklist-templates/:serviceTypeId', requirePermission('checklists.templates.edit'), (req, res) => {
  try {
    chkTemplates.setTemplate(req.params.serviceTypeId, req.body?.items);
  } catch (err) {
    return res.status(400).json({ error: String(err.message ?? err) });
  }
  res.json({ ok: true, templates: chkTemplates.getTemplates() });
});

router.delete('/api/checklist-templates/:serviceTypeId', requirePermission('checklists.templates.edit'), (req, res) => {
  chkTemplates.removeTemplate(req.params.serviceTypeId);
  res.json({ ok: true, templates: chkTemplates.getTemplates() });
});

// Check / uncheck a checklist item. Checking an item with an action executes
// it first (e.g. set the room mode) — the item only marks done if that works.
router.post('/api/rooms/:id/event/:planId/checklist/:itemId', requirePermission('checklists.complete'), async (req, res) => {
  const room = rooms[req.params.id];
  if (!room) return res.status(404).json({ error: 'Unknown room' });
  try {
    const plan = await planForRoom(room, req.params.planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const item = chkTemplates.templateFor(plan.serviceTypeId).find((i) => i.id === req.params.itemId);
    if (!item) return res.status(400).json({ error: 'Unknown checklist item' });

    const done = Boolean(req.body?.done);
    if (done && item.action?.type === 'mode') {
      if (!req.legacyAdmin && !auth.hasPermission(req.auth, 'rooms.mode.change')) {
        return res.status(403).json({ error: 'permission_required', permission: 'rooms.mode.change' });
      }
      const mode = room.modes.find((m) => m.id === item.action.mode);
      if (!mode) return res.status(400).json({ error: `Unknown mode '${item.action.mode}'` });
      // Lockouts apply here too — a checklist can't sidestep a protected window.
      const lockError = modeLockError(req, room.id, mode.id, req.body?.overridePin);
      if (lockError) return res.status(403).json(lockError);
      await applyMode(room, mode); // throws → 502 below, item stays unchecked
    }

    checklist.setItem(room.id, plan.id, item.id, done);
    auditSuccess(req, 'checklists.complete', {
      resourceType: 'checklist-item',
      resourceId: item.id,
      details: { done },
    });
    res.json({ checklist: checklist.getChecklist(room.id, plan.id, plan.serviceTypeId) });
  } catch (err) {
    res.status(502).json({ error: String(err.message ?? err) });
  }
});

// Timing report for a service instance (planned vs actual per item), plus the
// SPL block (avg Leq / peak vs the room's targets) when loudness was captured.
router.get('/api/rooms/:id/plan/:planId/report', (req, res) => {
  const timeId = String(req.query.time || 'default');
  const instance = `${req.params.planId}__${timeId}`;
  const report =
    timeline.getReport(instance) ?? { items: [], totals: { planned: 0, actual: 0, delta: 0 } };
  const analysisCfg = rooms[req.params.id]?.analysis;
  const agg = splStore.aggregate(instance);
  report.spl = agg
    ? { ...agg, target: analysisCfg?.target ?? null, limit: analysisCfg?.limit ?? null }
    : null;
  res.json(report);
});

// One room's upcoming plans, with the next plan's times + order of service.
router.get('/api/rooms/:id/service', async (req, res) => {
  const room = rooms[req.params.id];
  if (!room) return res.status(404).json({ error: 'Unknown room' });
  if (!room.planningCenter?.serviceTypes?.length) {
    return res.json({ configured: false, live: pco.isConfigured(), plans: [] });
  }
  try {
    const plans = await upcomingForRoom(room.planningCenter, 3);
    if (plans[0]) {
      const st = stOf(plans[0]);
      [plans[0].times, plans[0].items] = await Promise.all([
        pco.getPlanTimes(st, plans[0].id),
        pco.getPlanItems(st, plans[0].id),
      ]);
    }
    res.json({ configured: true, live: pco.isConfigured(), plans });
  } catch (err) {
    res.status(502).json({ configured: true, live: pco.isConfigured(), plans: [], error: String(err.message ?? err) });
  }
});

export default router;

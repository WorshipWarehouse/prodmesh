// Production dashboard backend.
//
//  • Serves the built frontend (dist/) in production.
//  • Proxies room state reads + mode triggers to Companion (avoids browser CORS).
//
// Run:  npm start      (serves dist/ + API on PORT, default 8080)
// Dev:  npm run dev     (Vite proxies /api here on 3001)

import express from 'express';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

import { rooms } from './rooms.config.js';
import { readCustomVariable, pressButton } from './companion.js';
import { publicRoom, rawToModeId } from './roomModel.js';
import { validateRooms } from './validate.js';
import * as settings from './settings.js';
import * as pco from './integrations/planningCenter.js';
import * as timeline from './timeline.js';
import * as show from './showManager.js';
import * as splStore from './splStore.js';
import * as checklist from './checklistStore.js';
import * as chkTemplates from './checklistTemplates.js';
import * as showCfg from './showConfig.js';
import * as ppro from './integrations/proPresenter.js';
import * as auth from './authStore.js';
import * as appConfig from './appConfig.js';
import * as connectivity from './connectivity.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT ?? (process.env.NODE_ENV === 'production' ? 8080 : 3001);

// Fail fast on a malformed room config instead of erroring deep in a request.
validateRooms(rooms);

// Require a valid admin bearer token. Attach to any admin-only route.
function bearer(req) {
  return (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
}

function resolveIdentity(req, _res, next) {
  req.station = auth.resolveStation(req.get('x-prodmesh-station'));
  const token = bearer(req);
  req.auth = auth.resolveSession(token);
  req.legacyAdmin = settings.checkSession(token);
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (req.legacyAdmin || auth.hasPermission(req.auth, permission)) return next();
    auth.audit({
      userId: req.auth?.user?.id,
      stationId: req.station?.id,
      action: permission,
      result: 'denied',
      roomId: req.params.id ?? null,
      planId: req.params.planId ?? null,
    });
    return res.status(req.auth ? 403 : 401).json({ error: 'permission_required', permission });
  };
}

function auditSuccess(req, action, context = {}) {
  auth.audit({
    userId: req.auth?.user?.id,
    stationId: req.station?.id,
    action,
    result: 'allowed',
    roomId: req.params.id ?? null,
    planId: req.params.planId ?? null,
    ...context,
  });
}

// In-memory state used when a room is in mock mode or Companion is unreachable.
const mockState = Object.create(null);
for (const id of Object.keys(rooms)) mockState[id] = 'standby';

const app = express();
app.use(express.json());
app.use(resolveIdentity);

// ── API ──────────────────────────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
app.get('/api/about', (_req, res) => res.json({ name: 'prodmesh', version: pkg.version }));

// Shows recorded before label-stamping existed (or while PC was unreachable)
// have no planTitle. Resolve those plans directly by id — Planning Center
// serves past plans fine, they just fall out of the "upcoming" list — and
// stamp the result into the timeline so it's a one-time repair per show.
const backfillDone = new Set(); // instanceIds tried this boot (hit or miss)
async function backfillLabels(tl) {
  if (tl.planTitle != null || !tl.roomId || !tl.planId) return;
  if (backfillDone.has(tl.instanceId)) return;
  backfillDone.add(tl.instanceId);
  for (const st of rooms[tl.roomId]?.planningCenter?.serviceTypes ?? []) {
    const plan = await pco.getPlan(st, tl.planId);
    if (!plan) continue; // not this service type (or PC not live)
    const time = await pco
      .getPlanTimes(st, tl.planId)
      .then((ts) => ts.find((t) => t.id === tl.timeId) ?? null)
      .catch(() => null);
    timeline.ensure(tl.instanceId, {
      planTitle: plan.title,
      serviceTypeName: plan.serviceTypeName,
      dates: plan.dates,
      timeName: time?.name ?? null,
      timeStartsAt: time?.startsAt ?? null,
    });
    return;
  }
}

// Every recorded show, newest first — powers the Analytics history view.
// Labels (planTitle etc.) are stamped at show start; unlabeled rows get a
// backfill attempt above before the response is built.
app.get('/api/history', async (_req, res) => {
  await Promise.all(timeline.listAll().map(backfillLabels));
  const shows = timeline
    .listAll()
    .map((tl) => {
      const room = rooms[tl.roomId] ?? null;
      const planned = tl.items.reduce((s, i) => s + (i.plannedLength || 0), 0);
      const actual = tl.items.reduce((s, i) => s + (i.actualSeconds || 0), 0);
      const agg = splStore.aggregate(tl.instanceId);
      return {
        instanceId: tl.instanceId,
        roomId: tl.roomId ?? null,
        roomName: room?.name ?? tl.roomId ?? null,
        site: room?.site ?? null,
        planId: tl.planId ?? null,
        timeId: tl.timeId ?? null,
        planTitle: tl.planTitle ?? null,
        serviceTypeName: tl.serviceTypeName ?? null,
        dates: tl.dates ?? null,
        timeName: tl.timeName ?? null,
        timeStartsAt: tl.timeStartsAt ?? null,
        startedAt: tl.items[0]?.startedAt ?? null,
        completedAt: tl.endedAt ?? null,
        itemCount: tl.items.length,
        totals: { planned, actual, delta: actual - planned },
        spl: agg
          ? { ...agg, target: room?.analysis?.target ?? null, limit: room?.analysis?.limit ?? null }
          : null,
      };
    })
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  res.json({ shows });
});

app.get('/api/rooms', (_req, res) => {
  res.json(Object.values(rooms).map(publicRoom));
});

app.get('/api/rooms/:id', (req, res) => {
  const room = rooms[req.params.id];
  if (!room) return res.status(404).json({ error: 'Unknown room' });
  res.json(publicRoom(room));
});

// Current room mode.
app.get('/api/rooms/:id/state', async (req, res) => {
  const room = rooms[req.params.id];
  if (!room) return res.status(404).json({ error: 'Unknown room' });

  const protection = settings.computeProtection(room.id);

  if (room.mock || !room.companion?.host) {
    const raw = mockState[room.id] ?? 'standby';
    return res.json({ mode: rawToModeId(room, raw), raw, online: false, source: 'mock', protection });
  }

  try {
    const raw = await readCustomVariable(room.companion, room.state.variable);
    res.json({ mode: rawToModeId(room, raw), raw, online: true, source: 'companion', protection });
  } catch (err) {
    // Fall back to last-known mock state so the page degrades gracefully.
    const raw = mockState[room.id] ?? 'standby';
    res.json({
      mode: rawToModeId(room, raw),
      raw,
      online: false,
      source: 'mock',
      protection,
      error: String(err.message ?? err),
    });
  }
});

// Switch the room to a mode (presses the mapped Companion button).
app.post('/api/rooms/:id/mode', requirePermission('rooms.mode.change'), async (req, res) => {
  const room = rooms[req.params.id];
  if (!room) return res.status(404).json({ error: 'Unknown room' });

  const mode = room.modes.find((m) => m.id === req.body?.mode);
  if (!mode) return res.status(400).json({ error: 'Unknown mode' });

  // Enforce lockout: a locked mode in a protected window needs the Override PIN.
  if (settings.isModeLocked(room.id, mode.id)) {
    const permitted = req.legacyAdmin || auth.hasPermission(req.auth, 'rooms.mode.override_lock');
    if (!permitted && !settings.verifyOverride(req.body?.overridePin)) {
      return res.status(403).json({ error: 'override_required', mode: mode.id });
    }
  }

  try {
    const result = await applyMode(room, mode);
    auditSuccess(req, 'rooms.mode.change', { resourceType: 'room-mode', resourceId: mode.id });
    res.json({ ok: true, mode: mode.id, ...result });
  } catch (err) {
    res.status(502).json({
      ok: false,
      mode: mode.id,
      online: false,
      error: String(err.message ?? err),
    });
  }
});

// Set a room's mode: presses the mapped Companion button. Shared by the mode
// endpoint and automated checklist items. Throws if Companion is unreachable.
async function applyMode(room, mode) {
  // Update mock state regardless, so the UI reflects intent if Companion is down.
  mockState[room.id] = mode.match ?? mode.id;
  if (room.mock || !room.companion?.host) return { online: false, source: 'mock' };
  if (mode.press) await pressButton(room.companion, mode.press);
  return { online: true, source: 'companion' };
}

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

// Overview: next service per configured room (for Quick Access).
app.get('/api/services', async (_req, res) => {
  const out = [];
  for (const room of Object.values(rooms)) {
    if (!room.planningCenter?.serviceTypes?.length) continue;
    try {
      const [next] = await upcomingForRoom(room.planningCenter, 1);
      if (next) next.times = await pco.getPlanTimes(stOf(next), next.id);
      out.push({ roomId: room.id, roomName: room.name, serviceType: next?.serviceTypeName ?? null, next: next ?? null });
    } catch (err) {
      out.push({ roomId: room.id, roomName: room.name, serviceType: null, next: null, error: String(err.message ?? err) });
    }
  }
  res.json({ live: pco.isConfigured(), services: out });
});

// A specific plan for a room, fully hydrated (times + order of service).
// Used by the Run of Show view.
app.get('/api/rooms/:id/plan/:planId', async (req, res) => {
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

app.get('/api/rooms/:id/event/:planId', async (req, res) => {
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

app.put('/api/rooms/:id/event/:planId/show-config', requirePermission('shows.configure'), (req, res) => {
  if (!rooms[req.params.id]) return res.status(404).json({ error: 'Unknown room' });
  try {
    const config = showCfg.setConfig(req.params.id, req.params.planId, req.body ?? {});
    show.refreshConfig(req.params.id, req.params.planId); // live show picks it up
    res.json({ ok: true, showConfig: config });
  } catch (err) {
    res.status(400).json({ error: String(err.message ?? err) });
  }
});

app.delete('/api/rooms/:id/event/:planId/show-config', requirePermission('shows.configure'), (req, res) => {
  if (!rooms[req.params.id]) return res.status(404).json({ error: 'Unknown room' });
  showCfg.clearConfig(req.params.id, req.params.planId);
  show.refreshConfig(req.params.id, req.params.planId);
  res.json({ ok: true, showConfig: null });
});

// The ProPresenter playlist to map THIS event against (for the mapping UI):
// prefers the playlist whose pushed name matches the plan; falls back to
// whatever's active in PP (matched: false → the UI warns it's a different
// service's playlist).
app.get('/api/rooms/:id/event/:planId/pp-playlist', async (req, res) => {
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
app.get('/api/checklist-templates', (_req, res) => {
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

app.put('/api/checklist-templates/:serviceTypeId', requirePermission('checklists.templates.edit'), (req, res) => {
  try {
    chkTemplates.setTemplate(req.params.serviceTypeId, req.body?.items);
  } catch (err) {
    return res.status(400).json({ error: String(err.message ?? err) });
  }
  res.json({ ok: true, templates: chkTemplates.getTemplates() });
});

app.delete('/api/checklist-templates/:serviceTypeId', requirePermission('checklists.templates.edit'), (req, res) => {
  chkTemplates.removeTemplate(req.params.serviceTypeId);
  res.json({ ok: true, templates: chkTemplates.getTemplates() });
});

// Check / uncheck a checklist item. Checking an item with an action executes
// it first (e.g. set the room mode) — the item only marks done if that works.
app.post('/api/rooms/:id/event/:planId/checklist/:itemId', requirePermission('checklists.complete'), async (req, res) => {
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
      if (settings.isModeLocked(room.id, mode.id)) {
        const permitted = req.legacyAdmin || auth.hasPermission(req.auth, 'rooms.mode.override_lock');
        if (!permitted && !settings.verifyOverride(req.body?.overridePin)) {
          return res.status(403).json({ error: 'override_required', mode: mode.id });
        }
      }
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
app.get('/api/rooms/:id/plan/:planId/report', (req, res) => {
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

// ── Show session (server-coordinated Run of Show) ──────────────────────────────

// Room-level show state stream (SSE). Browsers are pure views into this.
app.get('/api/rooms/:id/show/stream', (req, res) => {
  const roomId = req.params.id;
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  const hb = setInterval(() => res.write(': ping\n\n'), 20000);
  show.subscribe(roomId, res);
  req.on('close', () => {
    clearInterval(hb);
    show.unsubscribe(roomId, res);
  });
});

app.get('/api/rooms/:id/show', (req, res) => res.json(show.getState(req.params.id)));

app.post('/api/rooms/:id/show/start', requirePermission('shows.operate'), async (req, res) => {
  if (!rooms[req.params.id]) return res.status(404).json({ error: 'Unknown room' });
  try {
    res.json(await show.startShow(req.params.id, req.body?.planId, String(req.body?.timeId || 'default')));
  } catch (err) {
    res.status(err.code === 'conflict' ? 409 : 400).json({ error: String(err.message ?? err) });
  }
});

app.post('/api/rooms/:id/show/end', requirePermission('shows.operate'), (req, res) => {
  try {
    res.json(show.endShow(req.params.id));
  } catch (err) {
    res.status(err.code === 'not_found' ? 409 : 400).json({ error: String(err.message ?? err) });
  }
});

app.post('/api/rooms/:id/show/current', requirePermission('shows.operate'), (req, res) => {
  try {
    res.json(show.setCurrent(req.params.id, { itemId: req.body?.itemId, follow: req.body?.follow }));
  } catch (err) {
    res.status(err.code === 'not_found' ? 409 : 400).json({ error: String(err.message ?? err) });
  }
});

// One room's upcoming plans, with the next plan's times + order of service.
app.get('/api/rooms/:id/service', async (req, res) => {
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

// ── Auth ───────────────────────────────────────────────────────────────────────

// Station registration is deliberately unauthenticated: it identifies the
// browser installation, but grants no authority. Naming a machine is not login.
app.post('/api/stations/register', (req, res) => {
  try {
    res.status(201).json({ station: auth.registerStation(req.body ?? {}) });
  } catch (err) {
    res.status(400).json({ error: String(err.message ?? err) });
  }
});

app.get('/api/stations/current', (req, res) => {
  res.json({ station: req.station ?? null });
});

app.get('/api/stations', requirePermission('stations.manage'), (req, res) => {
  res.json({
    stations: auth.listStations().map((station) => ({
      ...station,
      current: station.id === req.station?.id,
    })),
  });
});

app.put('/api/stations/:stationId', requirePermission('stations.manage'), (req, res) => {
  try {
    const roomId = req.body?.roomId || null;
    const requestedCampus = req.body?.campusId || null;
    const room = roomId ? rooms[roomId] : null;
    if (roomId && !room) return res.status(400).json({ error: 'Unknown room' });
    const knownCampuses = new Set(Object.values(rooms).map((entry) => entry.site));
    if (requestedCampus && !knownCampuses.has(requestedCampus)) {
      return res.status(400).json({ error: 'Unknown campus' });
    }
    if (room && requestedCampus && room.site !== requestedCampus) {
      return res.status(400).json({ error: 'Room does not belong to that campus' });
    }
    const station = auth.updateStation(req.params.stationId, {
      name: req.body?.name,
      campusId: room?.site ?? requestedCampus,
      roomId,
    });
    auditSuccess(req, 'stations.manage', {
      resourceType: 'station', resourceId: station.id, details: { operation: 'update' },
    });
    res.json({ station: { ...station, current: station.id === req.station?.id } });
  } catch (err) {
    res.status(String(err.message ?? err).includes('Unknown') ? 404 : 400).json({ error: String(err.message ?? err) });
  }
});

app.delete('/api/stations/:stationId', requirePermission('stations.manage'), (req, res) => {
  try {
    const current = req.station?.id === req.params.stationId;
    const station = auth.revokeStation(req.params.stationId);
    auditSuccess(req, 'stations.manage', {
      resourceType: 'station', resourceId: station.id, details: { operation: 'revoke', name: station.name },
    });
    res.json({ ok: true, current });
  } catch (err) {
    res.status(404).json({ error: String(err.message ?? err) });
  }
});

const loginFailures = new Map();
function failureKey(req) {
  return `${req.station?.id ?? req.ip}:${String(req.body?.username ?? '').toLowerCase()}`;
}

app.post('/api/auth/login', (req, res) => {
  if (!req.station) return res.status(400).json({ error: 'station_required' });
  const key = failureKey(req);
  const failure = loginFailures.get(key);
  if (failure?.lockedUntil > Date.now()) {
    return res.status(429).json({ error: 'temporarily_locked', retryAfter: failure.lockedUntil - Date.now() });
  }
  const session = auth.authenticate(req.body?.username, req.body?.pin, req.station.id);
  if (!session) {
    const count = (failure?.count ?? 0) + 1;
    loginFailures.set(key, { count, lockedUntil: count >= 5 ? Date.now() + 60_000 : 0 });
    auth.audit({ stationId: req.station.id, action: 'auth.login', result: 'denied', details: { username: req.body?.username ?? '' } });
    return res.status(401).json({ error: 'Bad username or PIN' });
  }
  loginFailures.delete(key);
  auth.audit({ userId: session.user.id, stationId: req.station.id, action: 'auth.login', result: 'allowed' });
  res.json(session);
});

// Admin login. Returns a bearer token the client sends on admin requests.
app.post('/api/auth/admin', (req, res) => {
  if (!settings.verifyAdmin(req.body?.pin)) return res.status(401).json({ error: 'Bad PIN' });
  res.json({ token: settings.createSession() });
});

app.post('/api/auth/logout', (req, res) => {
  const token = bearer(req);
  if (req.auth) auth.audit({ userId: req.auth.user.id, stationId: req.station?.id, action: 'auth.logout', result: 'allowed' });
  auth.destroySession(token);
  settings.destroySession(token);
  res.json({ ok: true });
});

app.get('/api/auth/status', async (req, res) => {
  const legacy = req.legacyAdmin;
  const user = req.auth?.user ?? (legacy ? { id: 'legacy-admin', username: 'admin', displayName: 'System Administrator', planningCenterPersonId: null } : null);
  const pcProfile = user?.planningCenterPersonId
    ? await pco.getPersonProfile(user.planningCenterPersonId).catch(() => null)
    : null;
  res.json({
    authenticated: Boolean(req.auth || legacy),
    admin: Boolean(legacy || auth.hasPermission(req.auth, '*')),
    setupNeeded: settings.isAdminSetupNeeded(),
    user: user ? { ...user, avatarUrl: pcProfile?.avatarUrl ?? null } : null,
    permissions: legacy ? ['*'] : req.auth?.permissions ?? [],
    station: req.station ?? null,
  });
});

app.get('/api/users', requirePermission('users.manage'), async (_req, res) => {
  const directory = auth.listDirectory();
  directory.users = await Promise.all(directory.users.map(async (user) => {
    const profile = user.planningCenterPersonId
      ? await pco.getPersonProfile(user.planningCenterPersonId).catch(() => null)
      : null;
    return { ...user, avatarUrl: profile?.avatarUrl ?? null };
  }));
  res.json(directory);
});

app.post('/api/users', requirePermission('users.manage'), (req, res) => {
  try {
    const user = auth.createUser(req.body ?? {});
    auditSuccess(req, 'users.manage', { resourceType: 'user', resourceId: user.id, details: { operation: 'create' } });
    res.status(201).json({ user });
  } catch (err) {
    const message = String(err.message ?? err);
    res.status(message.includes('UNIQUE') ? 409 : 400).json({ error: message });
  }
});

app.post('/api/groups', requirePermission('users.manage'), (req, res) => {
  try {
    const group = auth.createGroup(req.body ?? {});
    auditSuccess(req, 'users.manage', { resourceType: 'permission-group', resourceId: group.id, details: { operation: 'create' } });
    res.status(201).json({ group });
  } catch (err) {
    const message = String(err.message ?? err);
    res.status(message.includes('UNIQUE') ? 409 : 400).json({ error: message });
  }
});

app.put('/api/users/:userId/groups', requirePermission('users.manage'), (req, res) => {
  try {
    const user = auth.updateUserGroups(req.params.userId, req.body?.groupIds ?? []);
    auditSuccess(req, 'users.manage', { resourceType: 'user', resourceId: user.id, details: { operation: 'groups' } });
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: String(err.message ?? err) });
  }
});

// ── Settings ───────────────────────────────────────────────────────────────────

app.get('/api/settings', requirePermission('settings.manage'), (_req, res) => {
  res.json(settings.getPublicSettings());
});

// Update PINs. Bootstrap exception: if no admin PIN exists yet, the first
// admin-PIN set is allowed without a token (first-run setup).
app.post('/api/settings/pins', (req, res) => {
  const bootstrapping = settings.isAdminSetupNeeded() && req.body?.admin;
  if (!bootstrapping) {
    if (!req.legacyAdmin && !auth.hasPermission(req.auth, 'settings.manage')) {
      return res.status(req.auth ? 403 : 401).json({ error: 'permission_required', permission: 'settings.manage' });
    }
  }
  settings.setPins({ admin: req.body?.admin, override: req.body?.override });
  res.json({ ok: true, ...settings.getPublicSettings().pins });
});

app.put('/api/settings/schedules', requirePermission('settings.manage'), (req, res) => {
  try {
    settings.setSchedules(req.body?.schedules);
  } catch (err) {
    return res.status(400).json({ error: String(err.message ?? err) });
  }
  res.json({ ok: true, schedules: settings.getPublicSettings().schedules });
});

// ── Institution config (name, sites, Quick Access tiles — ADR 0009) ───────────

// Public read: the shell needs it before anyone signs in (like /api/rooms).
app.get('/api/config', (_req, res) => {
  res.json(appConfig.getChurch());
});

// Whole-tree save from Admin → Campuses (transactional replace).
app.put('/api/config', requirePermission('config.manage'), (req, res) => {
  try {
    const stored = appConfig.replaceChurch(req.body);
    auditSuccess(req, 'config.manage', {
      resourceType: 'topology',
      details: {
        sites: stored.sites.length,
        tiles: stored.sites.flatMap((s) => s.auditoriums).flatMap((a) => a.tiles).length,
      },
    });
    res.json(stored);
  } catch (err) {
    res.status(400).json({ error: String(err.message ?? err) });
  }
});

// ── Room connectivity (room configuration page) ───────────────────────────────

// What integrations this room has. hasServerRoom=false means the topology
// knows the room but the server integration map (rooms.config.js) doesn't.
// The Smaart password never leaves the server: reads carry hasPassword only,
// and writes without a `password` field keep the stored one.
function redactAnalysis(cfg) {
  if (!cfg) return null;
  const { password, ...rest } = cfg;
  return { ...rest, hasPassword: Boolean(password) };
}

app.get('/api/config/rooms/:roomId/connectivity', (req, res) => {
  if (!rooms[req.params.roomId]) {
    return res.json({ hasServerRoom: false, planningCenter: null, analysis: null });
  }
  res.json({
    hasServerRoom: true,
    planningCenter: connectivity.getPlanningCenter(req.params.roomId) ?? { serviceTypes: [] },
    analysis: redactAnalysis(connectivity.getAnalysis(req.params.roomId)),
  });
});

app.put('/api/config/rooms/:roomId/connectivity/planning-center', requirePermission('config.manage'), (req, res) => {
  try {
    const stored = connectivity.setPlanningCenter(req.params.roomId, req.body?.serviceTypes);
    auditSuccess(req, 'config.manage', {
      resourceType: 'room-connectivity',
      resourceId: req.params.roomId,
      roomId: req.params.roomId,
      details: { integration: 'planningCenter', serviceTypes: stored.serviceTypes.length },
    });
    res.json({ planningCenter: stored });
  } catch (err) {
    res.status(rooms[req.params.roomId] ? 400 : 404).json({ error: String(err.message ?? err) });
  }
});

app.put('/api/config/rooms/:roomId/connectivity/analysis', requirePermission('config.manage'), (req, res) => {
  try {
    let input = req.body?.analysis ?? null;
    if (input && input.password === undefined) {
      const stored = connectivity.getAnalysis(req.params.roomId);
      if (stored?.password) input = { ...input, password: stored.password };
    }
    const clean = connectivity.setAnalysis(req.params.roomId, input);
    auditSuccess(req, 'config.manage', {
      resourceType: 'room-connectivity',
      resourceId: req.params.roomId,
      roomId: req.params.roomId,
      details: { integration: 'analysis', source: clean?.source ?? null },
    });
    res.json({ analysis: redactAnalysis(clean) });
  } catch (err) {
    res.status(rooms[req.params.roomId] ? 400 : 404).json({ error: String(err.message ?? err) });
  }
});

// ── System (version + self-update) ─────────────────────────────────────────────

app.get('/api/system/version', (_req, res) => {
  res.json(settings.getVersion());
});

// Trigger a self-update (git pull + build + service restart). Runs detached so
// it survives this process being restarted by the service manager; the client
// polls /api/system/version to see the new commit land.
app.post('/api/system/update', requirePermission('system.update'), (_req, res) => {
  const script = join(__dirname, '..', 'deploy', 'update.sh');
  try {
    const child = spawn('bash', [script], {
      cwd: join(__dirname, '..'),
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    res.json({ started: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message ?? err) });
  }
});

// ── Logs (Admin → Logs) ────────────────────────────────────────────────────────

// Tail of the server process log. The installed service (install-service.sh)
// writes stdout/stderr to <repo>/logs/server.log; PRODMESH_LOG_FILE overrides
// (tests, unusual deployments). Reads at most the last 512 KB.
app.get('/api/system/logs', requirePermission('system.logs'), async (req, res) => {
  const file = process.env.PRODMESH_LOG_FILE ?? join(__dirname, '..', 'logs', 'server.log');
  const lines = Math.max(50, Math.min(2000, Number(req.query.lines) || 500));
  try {
    const { stat, open } = await import('node:fs/promises');
    const info = await stat(file);
    const readFrom = Math.max(0, info.size - 512 * 1024);
    const fh = await open(file, 'r');
    let text;
    try {
      const { buffer, bytesRead } = await fh.read({
        buffer: Buffer.alloc(info.size - readFrom),
        position: readFrom,
      });
      text = buffer.toString('utf8', 0, bytesRead);
    } finally {
      await fh.close();
    }
    const all = text.split('\n');
    if (all.at(-1) === '') all.pop();
    if (readFrom > 0) all.shift(); // first line may be a partial from mid-file
    res.json({
      exists: true,
      file,
      size: info.size,
      mtime: info.mtimeMs,
      truncated: readFrom > 0 || all.length > lines,
      lines: all.slice(-lines),
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.json({ exists: false, file, lines: [] });
    }
    res.status(500).json({ error: String(err.message ?? err) });
  }
});

// The audit trail (named-user actions with station context) from SQLite.
app.get('/api/system/audit', requirePermission('system.logs'), (req, res) => {
  res.json({ entries: auth.listAudit(req.query.limit) });
});

// ── Static frontend (production) ───────────────────────────────────────────────
const distDir = join(__dirname, '..', 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback: any non-API route serves index.html so /room/:id works on reload.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(join(distDir, 'index.html'));
  });
}

// Only start listening when run directly (not when imported by tests).
if (process.argv[1] === __filename) {
  show.restoreShows().catch(() => {}); // resume any show that was active before restart
  show.initAutomation(); // per-room autostart watchers (PP-driven, browserless)
  app.listen(PORT, () => {
    console.log(`Production dashboard server on http://localhost:${PORT}`);
  });
}

export { app };

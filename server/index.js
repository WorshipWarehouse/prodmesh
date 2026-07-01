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
import { existsSync } from 'node:fs';

import { rooms } from './rooms.config.js';
import { readCustomVariable, pressButton } from './companion.js';
import { publicRoom, rawToModeId } from './roomModel.js';
import { validateRooms } from './validate.js';
import * as settings from './settings.js';
import * as pco from './integrations/planningCenter.js';
import * as ppro from './integrations/proPresenter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT ?? (process.env.NODE_ENV === 'production' ? 8080 : 3001);

// Fail fast on a malformed room config instead of erroring deep in a request.
validateRooms(rooms);

// Require a valid admin bearer token. Attach to any admin-only route.
function requireAdmin(req, res, next) {
  const token = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!settings.checkSession(token)) return res.status(401).json({ error: 'Admin auth required' });
  next();
}

// In-memory state used when a room is in mock mode or Companion is unreachable.
const mockState = Object.create(null);
for (const id of Object.keys(rooms)) mockState[id] = 'standby';

const app = express();
app.use(express.json());

// ── API ──────────────────────────────────────────────────────────────────────

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
app.post('/api/rooms/:id/mode', async (req, res) => {
  const room = rooms[req.params.id];
  if (!room) return res.status(404).json({ error: 'Unknown room' });

  const mode = room.modes.find((m) => m.id === req.body?.mode);
  if (!mode) return res.status(400).json({ error: 'Unknown mode' });

  // Enforce lockout: a locked mode in a protected window needs the Override PIN.
  if (settings.isModeLocked(room.id, mode.id)) {
    if (!settings.verifyOverride(req.body?.overridePin)) {
      return res.status(403).json({ error: 'override_required', mode: mode.id });
    }
  }

  // Update mock state regardless, so the UI reflects intent if Companion is down.
  mockState[room.id] = mode.match ?? mode.id;

  if (room.mock || !room.companion?.host) {
    return res.json({ ok: true, mode: mode.id, online: false, source: 'mock' });
  }

  try {
    if (mode.press) await pressButton(room.companion, mode.press);
    res.json({ ok: true, mode: mode.id, online: true, source: 'companion' });
  } catch (err) {
    res.status(502).json({
      ok: false,
      mode: mode.id,
      online: false,
      error: String(err.message ?? err),
    });
  }
});

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

// Live Run of Show tracking: streams the active order-of-service item id from
// ProPresenter (mapped from its active playlist item) to the browser via SSE.
app.get('/api/rooms/:id/run/:planId/stream', async (req, res) => {
  const room = rooms[req.params.id];
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const hb = setInterval(() => res.write(': ping\n\n'), 20000);
  const abort = new AbortController();
  req.on('close', () => {
    clearInterval(hb);
    abort.abort();
  });

  const pp = room?.proPresenter;
  if (!ppro.isConfigured(pp)) {
    send('status', { configured: false });
    return; // keep the connection open (heartbeat) but nothing to stream
  }

  // Load the plan's items once, for index → item-id mapping.
  let items = [];
  try {
    const plan = (await upcomingForRoom(room.planningCenter ?? {}, 10)).find((p) => p.id === req.params.planId);
    if (plan) items = await pco.getPlanItems(stOf(plan), plan.id);
  } catch {
    /* items stay [] — we'll still stream raw index/name */
  }

  send('status', { configured: true });
  try {
    await ppro.pollRunState(
      pp,
      (s) =>
        send('active', {
          itemId: ppro.mapIndexToItemId(items, { index: s.itemIndex, name: s.itemName }),
          index: s.itemIndex,
          name: s.itemName,
          slideIndex: s.slideIndex,
          slideCount: s.slideCount,
        }),
      abort.signal,
    );
  } catch (err) {
    if (!abort.signal.aborted) send('status', { configured: true, online: false, error: String(err.message ?? err) });
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

// Admin login. Returns a bearer token the client sends on admin requests.
app.post('/api/auth/admin', (req, res) => {
  if (!settings.verifyAdmin(req.body?.pin)) return res.status(401).json({ error: 'Bad PIN' });
  res.json({ token: settings.createSession() });
});

app.post('/api/auth/logout', requireAdmin, (req, res) => {
  settings.destroySession((req.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
  res.json({ ok: true });
});

app.get('/api/auth/status', (req, res) => {
  const token = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  res.json({ admin: settings.checkSession(token), setupNeeded: settings.isAdminSetupNeeded() });
});

// ── Settings ───────────────────────────────────────────────────────────────────

app.get('/api/settings', requireAdmin, (_req, res) => {
  res.json(settings.getPublicSettings());
});

// Update PINs. Bootstrap exception: if no admin PIN exists yet, the first
// admin-PIN set is allowed without a token (first-run setup).
app.post('/api/settings/pins', (req, res) => {
  const bootstrapping = settings.isAdminSetupNeeded() && req.body?.admin;
  if (!bootstrapping) {
    const token = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!settings.checkSession(token)) return res.status(401).json({ error: 'Admin auth required' });
  }
  settings.setPins({ admin: req.body?.admin, override: req.body?.override });
  res.json({ ok: true, ...settings.getPublicSettings().pins });
});

app.put('/api/settings/schedules', requireAdmin, (req, res) => {
  try {
    settings.setSchedules(req.body?.schedules);
  } catch (err) {
    return res.status(400).json({ error: String(err.message ?? err) });
  }
  res.json({ ok: true, schedules: settings.getPublicSettings().schedules });
});

// ── System (version + self-update) ─────────────────────────────────────────────

app.get('/api/system/version', (_req, res) => {
  res.json(settings.getVersion());
});

// Trigger a self-update (git pull + build + service restart). Runs detached so
// it survives this process being restarted by the service manager; the client
// polls /api/system/version to see the new commit land.
app.post('/api/system/update', requireAdmin, (_req, res) => {
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
  app.listen(PORT, () => {
    console.log(`Production dashboard server on http://localhost:${PORT}`);
  });
}

export { app };

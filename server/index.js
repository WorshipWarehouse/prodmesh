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
import * as settings from './settings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? (process.env.NODE_ENV === 'production' ? 8080 : 3001);

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

// Public view of a room: just what the UI needs to render (no button locations).
function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    hasCompanion: Boolean(room.companion?.host) && !room.mock,
    modes: room.modes.map((m) => ({
      id: m.id,
      label: m.label,
      color: m.color,
      isStandby: Boolean(m.isStandby),
    })),
  };
}

function rawToModeId(room, raw) {
  const v = (raw ?? '').trim().toLowerCase();
  const hit = room.modes.find((m) => (m.match ?? m.id).toLowerCase() === v);
  return hit ? hit.id : null;
}

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
  settings.setSchedules(req.body?.schedules);
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

app.listen(PORT, () => {
  console.log(`Production dashboard server on http://localhost:${PORT}`);
});

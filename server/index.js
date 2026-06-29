// Production dashboard backend.
//
//  • Serves the built frontend (dist/) in production.
//  • Proxies room state reads + mode triggers to Companion (avoids browser CORS).
//
// Run:  npm start      (serves dist/ + API on PORT, default 8080)
// Dev:  npm run dev     (Vite proxies /api here on 3001)

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import { rooms } from './rooms.config.js';
import { readCustomVariable, pressButton } from './companion.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? (process.env.NODE_ENV === 'production' ? 8080 : 3001);

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

  if (room.mock || !room.companion?.host) {
    const raw = mockState[room.id] ?? 'standby';
    return res.json({ mode: rawToModeId(room, raw), raw, online: false, source: 'mock' });
  }

  try {
    const raw = await readCustomVariable(room.companion, room.state.variable);
    res.json({ mode: rawToModeId(room, raw), raw, online: true, source: 'companion' });
  } catch (err) {
    // Fall back to last-known mock state so the page degrades gracefully.
    const raw = mockState[room.id] ?? 'standby';
    res.json({
      mode: rawToModeId(room, raw),
      raw,
      online: false,
      source: 'mock',
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

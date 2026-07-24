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

import { rooms } from './roomsStore.js';
import { validateRooms } from './validate.js';
import * as show from './showManager.js';
import * as splStore from './splStore.js';
import * as summaries from './showSummaries.js';
import { resolveIdentity } from './httpAuth.js';

import roomsRouter from './routes/rooms.js';
import showsRouter from './routes/shows.js';
import eventsRouter from './routes/events.js';
import authRouter from './routes/auth.js';
import adminConfigRouter from './routes/adminConfig.js';
import systemRouter from './routes/system.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT ?? (process.env.NODE_ENV === 'production' ? 8080 : 3001);

// Fail fast on a malformed room config instead of erroring deep in a request.
validateRooms(rooms);

const app = express();
app.use(express.json());
app.use(resolveIdentity);

// ── API (routers declare full /api/... paths) ─────────────────────────────────
app.use(roomsRouter);
app.use(eventsRouter);
app.use(showsRouter);
app.use(authRouter);
app.use(adminConfigRouter);
app.use(systemRouter);

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
  summaries.syncFromTimelines(); // legacy timelines → summary rows (one-time per boot)
  splStore.startRetention(); // prune old SPL samples now + daily
  app.listen(PORT, () => {
    console.log(`Production dashboard server on http://localhost:${PORT}`);
  });
}

export { app };

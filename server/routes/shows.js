// Show session (server-coordinated Run of Show).

import express from 'express';

import { rooms } from '../roomsStore.js';
import * as show from '../showManager.js';
import { requirePermission } from '../httpAuth.js';

const router = express.Router();

// Room-level show state stream (SSE). Browsers are pure views into this.
router.get('/api/rooms/:id/show/stream', (req, res) => {
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

router.get('/api/rooms/:id/show', (req, res) => res.json(show.getState(req.params.id)));

router.post('/api/rooms/:id/show/start', requirePermission('shows.operate'), async (req, res) => {
  if (!rooms[req.params.id]) return res.status(404).json({ error: 'Unknown room' });
  try {
    // A rehearsal runs the full show machinery under its own synthetic
    // timeId, so it never overwrites the real service's timeline and is
    // identifiable (and excludable from aggregates) by the prefix alone.
    const timeId = req.body?.rehearsal
      ? `rehearsal-${Date.now()}`
      : String(req.body?.timeId || 'default');
    res.json(await show.startShow(req.params.id, req.body?.planId, timeId));
  } catch (err) {
    res.status(err.code === 'conflict' ? 409 : 400).json({ error: String(err.message ?? err) });
  }
});

router.post('/api/rooms/:id/show/end', requirePermission('shows.operate'), (req, res) => {
  try {
    res.json(show.endShow(req.params.id));
  } catch (err) {
    res.status(err.code === 'not_found' ? 409 : 400).json({ error: String(err.message ?? err) });
  }
});

router.post('/api/rooms/:id/show/current', requirePermission('shows.operate'), (req, res) => {
  try {
    res.json(show.setCurrent(req.params.id, { itemId: req.body?.itemId, follow: req.body?.follow }));
  } catch (err) {
    res.status(err.code === 'not_found' ? 409 : 400).json({ error: String(err.message ?? err) });
  }
});

export default router;

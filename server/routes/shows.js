// Show session (server-coordinated Run of Show).

import express from 'express';

import { rooms } from '../roomsStore.js';
import * as show from '../showManager.js';
import * as hub from '../streamHub.js';
import { requirePermission } from '../httpAuth.js';

const router = express.Router();

/**
 * Room-level show state stream (SSE), the original single-room endpoint.
 *
 * Superseded by /api/stream, but kept: room-Mac homepages and bookmarks point
 * at views that use it, and it is the one URL an operator can open raw to see
 * whether the server is alive. It is now an ADAPTER — it subscribes to the
 * room's three topics and re-emits the combined `state` envelope on any of
 * them, so both surfaces are fed by one set of watchers and cannot drift.
 */
router.get('/api/rooms/:id/show/stream', (req, res) => {
  const roomId = req.params.id;
  // Unlike every sibling route this never checked the room existed, so any
  // string opened a stream — and subscribing starts the per-room timer
  // watcher, which polls that room's ProPresenter once a second for as long
  // as the connection is held. Unknown rooms are refused before any of that.
  if (!rooms[roomId]) return res.status(404).json({ error: 'Unknown room' });

  hub.openStream(req, res);

  // Any of the three topics firing means "the envelope changed" — getState()
  // reassembles it from all three, so the topic and value are unused here.
  // Coalesced to one send per tick: subscribing delivers three opening
  // snapshots, and this endpoint's contract is one paint, not three identical
  // ones.
  let pending = false;
  const flush = () => {
    pending = false;
    res.write(`event: state\ndata: ${JSON.stringify(show.getState(roomId))}\n\n`);
  };
  hub.subscribe(res, show.roomTopics(roomId), () => {
    if (pending) return;
    pending = true;
    queueMicrotask(flush);
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
    // planId is persisted (timeline JSON, show_summaries) and later replayed
    // into Planning Center request paths by backfillLabels, so it has to be
    // clean before it is STORED, not just before it is used. Charset rather
    // than digits-only: demo mode (no PC credentials) mints ids like
    // "mock-st1-0" and must keep working. This blocks every character that
    // could reshape a URL path; planningCenter.js then enforces digits-only
    // at the point a real request is actually built.
    const planId = String(req.body?.planId ?? '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(planId)) return res.status(400).json({ error: 'Invalid plan id' });
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(timeId)) return res.status(400).json({ error: 'Invalid time id' });
    res.json(await show.startShow(req.params.id, planId, timeId));
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

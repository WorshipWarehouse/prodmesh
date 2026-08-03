// The multiplexed live stream: one SSE connection per browser, many topics.
// See server/streamHub.js for why this exists rather than a stream per room.

import express from 'express';

import * as hub from '../streamHub.js';

const router = express.Router();

/**
 * GET /api/stream?topics=room:north-main:show,room:north-main:spl
 *
 * Topics the server doesn't publish (or that name an unknown room) are
 * ignored, not fatal: a saved dashboard referencing a room that has since been
 * deleted must still render its other eleven widgets. The client changes what
 * it wants by reconnecting with a new query — SSE is one-way, and a reconnect
 * is cheap next to holding a second socket open to negotiate.
 */
router.get('/api/stream', (req, res) => {
  const requested = String(req.query.topics ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, hub.MAX_TOPICS);

  hub.openStream(req, res);
  hub.subscribe(res, requested);
});

export default router;

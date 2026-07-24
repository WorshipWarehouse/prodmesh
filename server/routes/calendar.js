// Planning Center Calendar: room bookings for the Calendar page (read-only).

import express from 'express';

import * as cal from '../integrations/pcCalendar.js';

const router = express.Router();

const MAX_SPAN_MS = 62 * 86_400_000; // two months — the UI pages by week

// GET /api/calendar?start=<ISO>&end=<ISO> → bookings in [start, end).
router.get('/api/calendar', async (req, res) => {
  const start = Date.parse(String(req.query.start ?? ''));
  const end = Date.parse(String(req.query.end ?? ''));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return res.status(400).json({ error: 'start and end must be ISO dates with end after start' });
  }
  if (end - start > MAX_SPAN_MS) {
    return res.status(400).json({ error: 'Range too large (max 62 days)' });
  }
  try {
    const events = await cal.getEventInstances(start, end);
    res.json({
      live: cal.isConfigured(),
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      events,
    });
  } catch (err) {
    res.status(502).json({ error: String(err.message ?? err) });
  }
});

export default router;

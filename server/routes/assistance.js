// Assistance requests: station-scoped, no login required — the registered
// station is the identity (the volunteer at FOH may be read-only).

import express from 'express';

import * as assistance from '../assistance.js';
import { auditSuccess } from '../httpAuth.js';

const router = express.Router();

const toState = (entry) =>
  entry
    ? {
        active: true,
        requestedAt: entry.requestedAt,
        userName: entry.userName,
        message: entry.message,
        ack: entry.ack ? { name: entry.ack.name, at: entry.ack.at } : null,
      }
    : { active: false };

router.get('/api/assistance', (req, res) => {
  if (!req.station) return res.json({ active: false });
  res.json(toState(assistance.getForStation(req.station.id)));
});

router.post('/api/assistance', async (req, res) => {
  if (!req.station) {
    return res.status(400).json({ error: 'Register this station before requesting assistance' });
  }
  try {
    const message = String(req.body?.message ?? '').trim().slice(0, 300) || null;
    const entry = await assistance.request(req.station, req.auth?.user?.displayName ?? null, message);
    auditSuccess(req, 'assistance.request', {
      resourceType: 'station',
      resourceId: req.station.id,
    });
    res.json(toState(entry));
  } catch (err) {
    res.status(502).json({ error: `Couldn't notify the tech team: ${String(err.message ?? err)}` });
  }
});

router.delete('/api/assistance', async (req, res) => {
  if (!req.station) return res.status(400).json({ error: 'Unknown station' });
  const entry = await assistance.dismiss(req.station.id);
  if (entry) {
    auditSuccess(req, 'assistance.dismiss', {
      resourceType: 'station',
      resourceId: req.station.id,
    });
  }
  res.json({ active: false });
});

export default router;

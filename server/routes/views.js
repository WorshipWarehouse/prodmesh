// Views: a room's dashboards and displays.

import express from 'express';

import { rooms } from '../roomsStore.js';
import * as views from '../views.js';
import { requirePermission, auditSuccess } from '../httpAuth.js';

const router = express.Router();

/**
 * Reads are PUBLIC, and that is a requirement rather than a shortcut.
 *
 * A display is a screen with no keyboard — a Raspberry Pi wired into a video
 * multiview. It has to fetch its own layout before anyone could possibly log
 * in, so gating this would make the headline use case impossible. Everything
 * such a screen then needs is public for the same reason: /api/config,
 * /api/rooms/:id/service, /api/stream.
 *
 * A layout is a list of widget types and grid coordinates. It reveals strictly
 * less than the topology /api/config already serves to anyone on the LAN.
 */
router.get('/api/rooms/:id/views', (req, res) => {
  if (!rooms[req.params.id]) return res.status(404).json({ error: 'Unknown room' });
  res.json({ views: views.listViews(req.params.id) });
});

router.get('/api/views/:viewId', (req, res) => {
  const view = views.getView(req.params.viewId);
  if (!view) return res.status(404).json({ error: 'Unknown view' });
  res.json({ view });
});

/** Resolve by slug OR id, so renaming a view never breaks an assigned screen. */
router.get('/api/rooms/:id/views/:key', (req, res) => {
  if (!rooms[req.params.id]) return res.status(404).json({ error: 'Unknown room' });
  const view = views.getViewByKey(req.params.id, req.params.key);
  if (!view) return res.status(404).json({ error: 'Unknown view' });
  res.json({ view });
});

router.post('/api/rooms/:id/views', requirePermission('views.edit'), (req, res) => {
  if (!rooms[req.params.id]) return res.status(404).json({ error: 'Unknown room' });
  try {
    const view = views.createView({
      roomId: req.params.id,
      kind: req.body?.kind,
      name: req.body?.name,
      slug: req.body?.slug,
    });
    auditSuccess(req, 'views.edit', {
      resourceType: 'view',
      resourceId: view.id,
      details: { action: 'create', kind: view.kind, name: view.name },
    });
    res.status(201).json({ view });
  } catch (err) {
    res.status(400).json({ error: String(err.message ?? err) });
  }
});

router.put('/api/views/:viewId', requirePermission('views.edit'), (req, res) => {
  try {
    const view = views.replaceView(req.params.viewId, req.body ?? {});
    auditSuccess(req, 'views.edit', {
      resourceType: 'view',
      resourceId: view.id,
      // Explicit: auditSuccess reads roomId off req.params.id, and this route
      // is keyed by view id — without this every view edit lands in the trail
      // with a null room.
      roomId: view.roomId,
      details: { action: 'replace', kind: view.kind, widgets: view.widgets.length },
    });
    res.json({ view });
  } catch (err) {
    const unknown = /^Unknown view$/.test(String(err.message));
    res.status(unknown ? 404 : 400).json({ error: String(err.message ?? err) });
  }
});

router.delete('/api/views/:viewId', requirePermission('views.edit'), (req, res) => {
  const view = views.deleteView(req.params.viewId);
  if (!view) return res.status(404).json({ error: 'Unknown view' });
  auditSuccess(req, 'views.edit', {
    resourceType: 'view',
    resourceId: view.id,
    roomId: view.roomId,
    details: { action: 'delete', kind: view.kind, name: view.name },
  });
  res.json({ ok: true });
});

export default router;

// Admin configuration: settings/PINs/schedules, institution config (ADR 0009),
// and per-room connectivity.

import express from 'express';

import { rooms, rebuildRooms } from '../roomsStore.js';
import * as settings from '../settings.js';
import * as show from '../showManager.js';
import * as auth from '../authStore.js';
import * as appConfig from '../appConfig.js';
import * as connectivity from '../connectivity.js';
import { roomStatus } from '../connectivityStatus.js';
import { requirePermission, auditSuccess } from '../httpAuth.js';

const router = express.Router();

// ── Settings ───────────────────────────────────────────────────────────────────

router.get('/api/settings', requirePermission('settings.manage'), (_req, res) => {
  res.json(settings.getPublicSettings());
});

// Update PINs. Bootstrap exception: if no admin PIN exists yet, the first
// admin-PIN set is allowed without a token (first-run setup).
router.post('/api/settings/pins', (req, res) => {
  const bootstrapping = settings.isAdminSetupNeeded() && req.body?.admin;
  if (!bootstrapping) {
    if (!req.legacyAdmin && !auth.hasPermission(req.auth, 'settings.manage')) {
      return res.status(req.auth ? 403 : 401).json({ error: 'permission_required', permission: 'settings.manage' });
    }
  }
  settings.setPins({ admin: req.body?.admin, override: req.body?.override });
  res.json({ ok: true, ...settings.getPublicSettings().pins });
});

router.put('/api/settings/schedules', requirePermission('settings.manage'), (req, res) => {
  try {
    settings.setSchedules(req.body?.schedules);
  } catch (err) {
    return res.status(400).json({ error: String(err.message ?? err) });
  }
  res.json({ ok: true, schedules: settings.getPublicSettings().schedules });
});

// ── Institution config (name, sites, Quick Access tiles — ADR 0009) ───────────

// Public read: the shell needs it before anyone signs in (like /api/rooms).
router.get('/api/config', (_req, res) => {
  res.json(appConfig.getChurch());
});

// Whole-tree save from Admin → Campuses (transactional replace).
router.put('/api/config', requirePermission('config.manage'), (req, res) => {
  try {
    const stored = appConfig.replaceChurch(req.body);
    // Topology edits become real server rooms immediately: rebuild the live
    // map, re-apply stored connectivity onto the (possibly new) room objects,
    // and reconcile per-room watchers/shows with the result.
    rebuildRooms();
    connectivity.applyConnectivity();
    show.syncAutomation();
    auditSuccess(req, 'config.manage', {
      resourceType: 'topology',
      details: {
        sites: stored.sites.length,
        tiles: stored.sites.flatMap((s) => s.auditoriums).flatMap((a) => a.tiles).length,
      },
    });
    res.json(stored);
  } catch (err) {
    res.status(400).json({ error: String(err.message ?? err) });
  }
});

// ── Room connectivity (room configuration page) ───────────────────────────────

// What integrations this room has. hasServerRoom=false means the topology
// knows the room but the server integration map (rooms.config.js) doesn't.
// The Smaart password never leaves the server: reads carry hasPassword only,
// and writes without a `password` field keep the stored one.
function redactAnalysis(cfg) {
  if (!cfg) return null;
  const { password, ...rest } = cfg;
  return { ...rest, hasPassword: Boolean(password) };
}

router.get('/api/config/rooms/:roomId/connectivity', (req, res) => {
  if (!rooms[req.params.roomId]) {
    return res.json({
      hasServerRoom: false, planningCenter: null, analysis: null, proPresenter: null, companion: null,
    });
  }
  res.json({
    hasServerRoom: true,
    planningCenter: connectivity.getPlanningCenter(req.params.roomId) ?? { serviceTypes: [] },
    analysis: redactAnalysis(connectivity.getAnalysis(req.params.roomId)),
    proPresenter: connectivity.getProPresenter(req.params.roomId),
    // A room with no stored row yet (created in Admin → Campuses) shows its
    // live defaults so the editor opens pre-filled rather than unsavable.
    companion:
      connectivity.getCompanion(req.params.roomId) ??
      connectivity.companionFromRoom(rooms[req.params.roomId]),
  });
});

// Live per-integration status (the chips next to each editor). Probes the
// room's devices on demand — behind config.manage since it generates real
// outbound requests.
router.get('/api/config/rooms/:roomId/connectivity/status', requirePermission('config.manage'), async (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) return res.status(404).json({ error: 'unknown room' });
  res.json(await roomStatus(room));
});

router.put('/api/config/rooms/:roomId/connectivity/planning-center', requirePermission('config.manage'), (req, res) => {
  try {
    const stored = connectivity.setPlanningCenter(req.params.roomId, req.body?.serviceTypes);
    auditSuccess(req, 'config.manage', {
      resourceType: 'room-connectivity',
      resourceId: req.params.roomId,
      roomId: req.params.roomId,
      details: { integration: 'planningCenter', serviceTypes: stored.serviceTypes.length },
    });
    res.json({ planningCenter: stored });
  } catch (err) {
    res.status(rooms[req.params.roomId] ? 400 : 404).json({ error: String(err.message ?? err) });
  }
});

router.put('/api/config/rooms/:roomId/connectivity/analysis', requirePermission('config.manage'), (req, res) => {
  try {
    let input = req.body?.analysis ?? null;
    if (input && input.password === undefined) {
      const stored = connectivity.getAnalysis(req.params.roomId);
      if (stored?.password) input = { ...input, password: stored.password };
    }
    const clean = connectivity.setAnalysis(req.params.roomId, input);
    auditSuccess(req, 'config.manage', {
      resourceType: 'room-connectivity',
      resourceId: req.params.roomId,
      roomId: req.params.roomId,
      details: { integration: 'analysis', source: clean?.source ?? null },
    });
    res.json({ analysis: redactAnalysis(clean) });
  } catch (err) {
    res.status(rooms[req.params.roomId] ? 400 : 404).json({ error: String(err.message ?? err) });
  }
});

router.put('/api/config/rooms/:roomId/connectivity/companion', requirePermission('config.manage'), (req, res) => {
  try {
    const clean = connectivity.setCompanion(req.params.roomId, req.body?.companion);
    auditSuccess(req, 'config.manage', {
      resourceType: 'room-connectivity',
      resourceId: req.params.roomId,
      roomId: req.params.roomId,
      details: { integration: 'companion', mock: clean.mock, modes: clean.modes.length },
    });
    res.json({ companion: clean });
  } catch (err) {
    res.status(rooms[req.params.roomId] ? 400 : 404).json({ error: String(err.message ?? err) });
  }
});

router.put('/api/config/rooms/:roomId/connectivity/propresenter', requirePermission('config.manage'), (req, res) => {
  try {
    const clean = connectivity.setProPresenter(req.params.roomId, req.body?.proPresenter ?? null);
    auditSuccess(req, 'config.manage', {
      resourceType: 'room-connectivity',
      resourceId: req.params.roomId,
      roomId: req.params.roomId,
      details: { integration: 'proPresenter', host: clean?.host ?? null },
    });
    res.json({ proPresenter: clean });
  } catch (err) {
    res.status(rooms[req.params.roomId] ? 400 : 404).json({ error: String(err.message ?? err) });
  }
});

export default router;

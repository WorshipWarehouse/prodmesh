// Auth: stations, login/logout/status, users and permission groups.

import express from 'express';

import { rooms } from '../roomsStore.js';
import * as settings from '../settings.js';
import * as pco from '../integrations/planningCenter.js';
import * as auth from '../authStore.js';
import { bearer, requirePermission, auditSuccess } from '../httpAuth.js';

const router = express.Router();

// Station registration is deliberately unauthenticated: it identifies the
// browser installation, but grants no authority. Naming a machine is not login.
router.post('/api/stations/register', (req, res) => {
  try {
    res.status(201).json({ station: auth.registerStation(req.body ?? {}) });
  } catch (err) {
    res.status(400).json({ error: String(err.message ?? err) });
  }
});

router.get('/api/stations/current', (req, res) => {
  res.json({ station: req.station ?? null });
});

router.get('/api/stations', requirePermission('stations.manage'), (req, res) => {
  res.json({
    stations: auth.listStations().map((station) => ({
      ...station,
      current: station.id === req.station?.id,
    })),
  });
});

router.put('/api/stations/:stationId', requirePermission('stations.manage'), (req, res) => {
  try {
    const roomId = req.body?.roomId || null;
    const requestedCampus = req.body?.campusId || null;
    const room = roomId ? rooms[roomId] : null;
    if (roomId && !room) return res.status(400).json({ error: 'Unknown room' });
    const knownCampuses = new Set(Object.values(rooms).map((entry) => entry.site));
    if (requestedCampus && !knownCampuses.has(requestedCampus)) {
      return res.status(400).json({ error: 'Unknown campus' });
    }
    if (room && requestedCampus && room.site !== requestedCampus) {
      return res.status(400).json({ error: 'Room does not belong to that campus' });
    }
    const station = auth.updateStation(req.params.stationId, {
      name: req.body?.name,
      campusId: room?.site ?? requestedCampus,
      roomId,
    });
    auditSuccess(req, 'stations.manage', {
      resourceType: 'station', resourceId: station.id, details: { operation: 'update' },
    });
    res.json({ station: { ...station, current: station.id === req.station?.id } });
  } catch (err) {
    res.status(String(err.message ?? err).includes('Unknown') ? 404 : 400).json({ error: String(err.message ?? err) });
  }
});

router.delete('/api/stations/:stationId', requirePermission('stations.manage'), (req, res) => {
  try {
    const current = req.station?.id === req.params.stationId;
    const station = auth.revokeStation(req.params.stationId);
    auditSuccess(req, 'stations.manage', {
      resourceType: 'station', resourceId: station.id, details: { operation: 'revoke', name: station.name },
    });
    res.json({ ok: true, current });
  } catch (err) {
    res.status(404).json({ error: String(err.message ?? err) });
  }
});

const loginFailures = new Map();
function failureKey(req) {
  return `${req.station?.id ?? req.ip}:${String(req.body?.username ?? '').toLowerCase()}`;
}

router.post('/api/auth/login', (req, res) => {
  if (!req.station) return res.status(400).json({ error: 'station_required' });
  const key = failureKey(req);
  const failure = loginFailures.get(key);
  if (failure?.lockedUntil > Date.now()) {
    return res.status(429).json({ error: 'temporarily_locked', retryAfter: failure.lockedUntil - Date.now() });
  }
  const session = auth.authenticate(req.body?.username, req.body?.pin, req.station.id);
  if (!session) {
    const count = (failure?.count ?? 0) + 1;
    loginFailures.set(key, { count, lockedUntil: count >= 5 ? Date.now() + 60_000 : 0 });
    auth.audit({ stationId: req.station.id, action: 'auth.login', result: 'denied', details: { username: req.body?.username ?? '' } });
    return res.status(401).json({ error: 'Bad username or PIN' });
  }
  loginFailures.delete(key);
  auth.audit({ userId: session.user.id, stationId: req.station.id, action: 'auth.login', result: 'allowed' });
  res.json(session);
});

// Admin login. Returns a bearer token the client sends on admin requests.
router.post('/api/auth/admin', (req, res) => {
  if (!settings.verifyAdmin(req.body?.pin)) return res.status(401).json({ error: 'Bad PIN' });
  res.json({ token: settings.createSession() });
});

router.post('/api/auth/logout', (req, res) => {
  const token = bearer(req);
  if (req.auth) auth.audit({ userId: req.auth.user.id, stationId: req.station?.id, action: 'auth.logout', result: 'allowed' });
  auth.destroySession(token);
  settings.destroySession(token);
  res.json({ ok: true });
});

router.get('/api/auth/status', async (req, res) => {
  const legacy = req.legacyAdmin;
  const user = req.auth?.user ?? (legacy ? { id: 'legacy-admin', username: 'admin', displayName: 'System Administrator', planningCenterPersonId: null } : null);
  const pcProfile = user?.planningCenterPersonId
    ? await pco.getPersonProfile(user.planningCenterPersonId).catch(() => null)
    : null;
  res.json({
    authenticated: Boolean(req.auth || legacy),
    admin: Boolean(legacy || auth.hasPermission(req.auth, '*')),
    setupNeeded: settings.isAdminSetupNeeded(),
    user: user ? { ...user, avatarUrl: pcProfile?.avatarUrl ?? null } : null,
    permissions: legacy ? ['*'] : req.auth?.permissions ?? [],
    station: req.station ?? null,
  });
});

router.get('/api/users', requirePermission('users.manage'), async (_req, res) => {
  const directory = auth.listDirectory();
  directory.users = await Promise.all(directory.users.map(async (user) => {
    const profile = user.planningCenterPersonId
      ? await pco.getPersonProfile(user.planningCenterPersonId).catch(() => null)
      : null;
    return { ...user, avatarUrl: profile?.avatarUrl ?? null };
  }));
  res.json(directory);
});

router.post('/api/users', requirePermission('users.manage'), (req, res) => {
  try {
    const user = auth.createUser(req.body ?? {});
    auditSuccess(req, 'users.manage', { resourceType: 'user', resourceId: user.id, details: { operation: 'create' } });
    res.status(201).json({ user });
  } catch (err) {
    const message = String(err.message ?? err);
    res.status(message.includes('UNIQUE') ? 409 : 400).json({ error: message });
  }
});

router.post('/api/groups', requirePermission('users.manage'), (req, res) => {
  try {
    const group = auth.createGroup(req.body ?? {});
    auditSuccess(req, 'users.manage', { resourceType: 'permission-group', resourceId: group.id, details: { operation: 'create' } });
    res.status(201).json({ group });
  } catch (err) {
    const message = String(err.message ?? err);
    res.status(message.includes('UNIQUE') ? 409 : 400).json({ error: message });
  }
});

router.put('/api/users/:userId/groups', requirePermission('users.manage'), (req, res) => {
  try {
    const user = auth.updateUserGroups(req.params.userId, req.body?.groupIds ?? []);
    auditSuccess(req, 'users.manage', { resourceType: 'user', resourceId: user.id, details: { operation: 'groups' } });
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: String(err.message ?? err) });
  }
});

export default router;

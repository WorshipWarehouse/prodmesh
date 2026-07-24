// HTTP-layer identity + permission helpers shared by all routers.

import * as settings from './settings.js';
import * as auth from './authStore.js';

// Require a valid admin bearer token. Attach to any admin-only route.
export function bearer(req) {
  return (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
}

export function resolveIdentity(req, _res, next) {
  req.station = auth.resolveStation(req.get('x-prodmesh-station'));
  const token = bearer(req);
  req.auth = auth.resolveSession(token);
  req.legacyAdmin = settings.checkSession(token);
  next();
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (req.legacyAdmin || auth.hasPermission(req.auth, permission)) return next();
    auth.audit({
      userId: req.auth?.user?.id,
      stationId: req.station?.id,
      action: permission,
      result: 'denied',
      roomId: req.params.id ?? null,
      planId: req.params.planId ?? null,
    });
    return res.status(req.auth ? 403 : 401).json({ error: 'permission_required', permission });
  };
}

export function auditSuccess(req, action, context = {}) {
  auth.audit({
    userId: req.auth?.user?.id,
    stationId: req.station?.id,
    action,
    result: 'allowed',
    roomId: req.params.id ?? null,
    planId: req.params.planId ?? null,
    ...context,
  });
}

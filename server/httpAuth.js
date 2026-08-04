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

// Permission id → the human label Admin → Users shows for it. Sent with a
// refusal so the browser can say WHICH authority is missing without shipping a
// second copy of this list that drifts from PERMISSIONS.
const LABELS = new Map(auth.PERMISSIONS.map(([id, label]) => [id, label]));

/** The refusal body, for the routes whose check is too particular for
 *  requirePermission and which would otherwise answer in a different shape. */
export const permissionRequired = (permission) => ({
  error: 'permission_required',
  permission,
  label: LABELS.get(permission) ?? permission,
});

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
    // 403 vs 401 is the browser's only way to tell "this operator lacks the
    // permission" from "nobody is logged in" — two refusals that need very
    // different words on screen.
    return res.status(req.auth ? 403 : 401).json(permissionRequired(permission));
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

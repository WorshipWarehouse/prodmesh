// ─────────────────────────────────────────────────────────────────────────────
//  FIRST-RUN SETUP  —  is this install still waiting to be claimed?
//
//  A fresh box has no admin PIN and no campuses (appConfig.js deliberately
//  seeds nothing on a real install), so the app it would otherwise render is
//  an empty shell with a station dialog on top. The wizard takes over instead
//  and hands back a usable install.
//
//  Two facts decide the state, and both are already public knowledge:
//  /api/auth/status reports setupNeeded, /api/config lists the campuses. This
//  module only joins them with the stored "the wizard finished" stamp, so the
//  endpoint leaks nothing new.
// ─────────────────────────────────────────────────────────────────────────────

import * as settings from './settings.js';
import * as appConfig from './appConfig.js';

const hasCampus = () => appConfig.getChurch().sites.length > 0;

/**
 * Upgrades must never see a setup wizard.
 *
 * The original production box predates the stamp: it has a PIN and campuses, and
 * update.sh would otherwise restart it into first-run setup. An install that
 * is ALREADY configured when the process starts is by definition not a fresh
 * one, so it is stamped complete here, once, at boot.
 *
 * Deliberately boot-time rather than per-request: mid-wizard, an install
 * briefly looks "configured" (the PIN is step one, the campus is step three),
 * and a per-request version would declare setup finished underneath the church
 * still filling it in.
 */
function reconcileExistingInstall() {
  if (settings.getSetupCompletedAt()) return;
  if (!settings.isAdminSetupNeeded() && hasCampus()) settings.markSetupComplete();
}
reconcileExistingInstall();

/** What the wizard needs to know: whether to run, and how far it got. */
export function getState() {
  const completedAt = settings.getSetupCompletedAt();
  return {
    needed: completedAt == null,
    completedAt,
    adminPinSet: !settings.isAdminSetupNeeded(),
    hasCampus: hasCampus(),
  };
}

/** The wizard's last step. Idempotent — the first stamp wins. */
export function complete() {
  settings.markSetupComplete();
  return getState();
}

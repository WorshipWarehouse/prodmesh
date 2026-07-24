// ─────────────────────────────────────────────────────────────────────────────
//  INTEGRATION HEALTH  —  in-memory per-integration status registry.
//
//  The transport choke points (the one place each integration really talks to
//  the network) call report(key, ok, message) on every real request, so the
//  graceful-degradation fallbacks above them can stay — what happened underneath
//  is now recorded and visible at GET /api/system/health.
//
//  Logging follows the smaart.js watcher pattern: ONE line when an integration
//  goes down (the ok→fail transition) and one when it recovers — never one per
//  retry, so a Sunday-morning outage is a grep-able pair of lines, not a flood.
//
//  Keys are stable identifiers ("planningCenter", "proPresenter@host:port",
//  "companion@host:port", "analysis@host:port") — bounded by the number of
//  configured integrations, so the Map cannot grow without bound.
// ─────────────────────────────────────────────────────────────────────────────

const integrations = new Map(); // key → { lastSuccess, lastError, consecutiveFailures }

/** Record one real request's outcome for an integration key. */
export function report(key, ok, errorMessage) {
  let e = integrations.get(key);
  if (!e) {
    e = { lastSuccess: null, lastError: null, consecutiveFailures: 0 };
    integrations.set(key, e);
  }
  if (ok) {
    if (e.consecutiveFailures > 0) {
      console.log(
        `[health] ${key}: recovered after ${e.consecutiveFailures} failure${e.consecutiveFailures === 1 ? '' : 's'}`,
      );
    }
    e.lastSuccess = Date.now();
    e.consecutiveFailures = 0;
  } else {
    e.consecutiveFailures += 1;
    e.lastError = { ts: Date.now(), message: String(errorMessage ?? 'unknown error') };
    if (e.consecutiveFailures === 1) console.error(`[health] ${key}: ${e.lastError.message}`);
  }
}

/** Plain-object view for the API: { [key]: { ok, lastSuccess, lastError, consecutiveFailures } }. */
export function snapshot() {
  const out = {};
  for (const [key, e] of integrations) {
    out[key] = {
      // ok = the latest report was a success — i.e. lastSuccess is newer than
      // lastError (lastError is kept after recovery as outage history).
      ok: e.consecutiveFailures === 0,
      lastSuccess: e.lastSuccess,
      lastError: e.lastError,
      consecutiveFailures: e.consecutiveFailures,
    };
  }
  return out;
}

/** Tests only — forget every recorded status. */
export function reset() {
  integrations.clear();
}

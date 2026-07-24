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

/**
 * Register a configured integration before it's ever contacted, so the health
 * surface lists everything that SHOULD be reachable — not just what happened
 * to be used since boot. A declared-but-uncontacted entry reports ok: null.
 */
export function declare(key) {
  if (!integrations.has(key)) {
    integrations.set(key, { lastSuccess: null, lastError: null, consecutiveFailures: 0 });
  }
}

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
      // ok = the latest report was a success (lastError is kept after
      // recovery as outage history). null = declared but never contacted yet.
      ok: e.lastSuccess == null && e.lastError == null ? null : e.consecutiveFailures === 0,
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

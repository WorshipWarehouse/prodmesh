// ─────────────────────────────────────────────────────────────────────────────
//  ASSISTANCE REQUESTS  —  the Lowe's aisle button.
//
//  A station (any volunteer, no login needed — the station IS the identity)
//  requests help; the tech team channel gets a Slack message; a red bar on
//  that station reminds everyone help is on the way. Whoever responds (or the
//  requester) presses Dismiss at the station, which ✅s the original Slack
//  message so the channel reads as a live open/closed board.
//
//  In-memory by design: an assistance request shouldn't outlive a server
//  restart — a stale "help is coming" bar is worse than asking again.
// ─────────────────────────────────────────────────────────────────────────────

import * as slack from './integrations/slack.js';

const requests = new Map(); // stationId → { stationId, stationName, userName, requestedAt, slack }

export function getForStation(stationId) {
  return requests.get(stationId) ?? null;
}

/**
 * Open a request for a station (idempotent — a pending request is returned,
 * not re-posted, so a nervous double-tap can't spam the channel). Throws if
 * Slack is configured but unreachable: a silent failure would leave the
 * volunteer believing help was coming.
 */
export async function request(station, userName = null) {
  const existing = requests.get(station.id);
  if (existing) return existing;

  const text = `:red_circle: ${
    userName ? `*${userName}* has requested` : 'Someone has requested'
  } technical assistance at *${station.name}*`;

  let posted = null;
  if (slack.isConfigured()) {
    posted = await slack.postMessage(text);
  } else {
    console.log(`[assistance] (slack not configured) ${text}`);
  }

  const entry = {
    stationId: station.id,
    stationName: station.name,
    userName,
    requestedAt: Date.now(),
    slack: posted,
  };
  requests.set(station.id, entry);
  return entry;
}

/**
 * Close a station's request. The ✅ reaction is best-effort — the local state
 * always clears (the responder is standing at the station; a Slack hiccup
 * shouldn't trap the red bar on screen), and failures land in health.
 */
export async function dismiss(stationId) {
  const entry = requests.get(stationId);
  if (!entry) return null;
  requests.delete(stationId);
  if (entry.slack) {
    await slack.addReaction(entry.slack.channel, entry.slack.ts).catch(() => {});
  }
  return entry;
}

/** Tests only. */
export function reset() {
  requests.clear();
}

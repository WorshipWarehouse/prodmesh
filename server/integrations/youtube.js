// ─────────────────────────────────────────────────────────────────────────────
//  INTEGRATION: YouTube Live  —  concurrent viewers on the church's stream.
//
//  THE CONSTRAINT THAT SHAPES EVERYTHING HERE: `concurrentViewers` exists only
//  while the broadcast is live. It is gone the moment the stream ends, and it
//  is absent entirely if the broadcaster hid the counter. YouTube will not tell
//  us retroactively what the curve looked like without OAuth-gated Analytics.
//
//  So the graph in a Show Report can only ever be OUR OWN RECORDING. This is a
//  sampling integration, structurally identical to SPL: poll while a show is
//  live, write to SQLite, aggregate at the end.
//
//  QUOTA. The Data API allows 10,000 units/day by default:
//    videos.list?part=liveStreamingDetails   1 unit   ← the viewer count
//    search.list (find the live video)     100 units  ← 100x more expensive
//  So the live video id is resolved rarely and cached; viewers are polled
//  often. A 90-minute service at 30s intervals is ~180 units, plus a handful
//  of searches. Comfortable.
//
//  API KEY, NOT OAUTH. A key reads public data, which a church livestream is.
//  OAuth would additionally reach unlisted/private broadcasts and retroactive
//  analytics, at the cost of a Google verification review for the
//  youtube.readonly scope. Not worth it for the first version.
//
//  NO AUTOMATIC MOCK. Every other integration falls back to sample data with
//  no credentials; this one does not, and the reason is the same one that
//  stopped PersonPicker mocking: these numbers get PERSISTED and then shown in
//  a report someone may well put in front of their elders. A fabricated
//  attendance figure is worse than a blank one. `mock: true` exists as a dev
//  fixture that only rooms.config.js declares, exactly like analysis.mock.
// ─────────────────────────────────────────────────────────────────────────────

import { report } from '../health.js';
import { getSecret } from '../secrets.js';

const API = 'https://www.googleapis.com/youtube/v3';

const DEFAULT_POLL_MS = 30_000;
// A search costs 100x a viewer read, so re-resolving is rare. A church starts
// its stream once; this only has to notice that it eventually appeared.
const RESOLVE_TTL_MS = 15 * 60_000;
const RESOLVE_RETRY_MS = 2 * 60_000; // nothing live yet — look again sooner
const REQUEST_TIMEOUT_MS = 10_000;

/** Configured = we know where to look. An explicit video id skips the search. */
export const isConfigured = (cfg) => Boolean(cfg && (cfg.mock || cfg.videoId || cfg.channelId));

/** Whether this room can actually reach YouTube (a key is needed for real use). */
export const hasCredentials = () => Boolean(getSecret('youtube.apiKey'));

export const healthKey = (cfg) => `youtube@${cfg?.channelId || cfg?.videoId || 'unset'}`;

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const onAbort = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    t.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function apiGet(path, params, signal) {
  const key = getSecret('youtube.apiKey');
  if (!key) throw new Error('No YouTube API key configured');
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set('key', key);

  // The key must never reach a log or an error message — errors from here are
  // surfaced in Admin → Health, which is a screen, and screens get shared.
  const safeUrl = `${API}/${path}?${new URLSearchParams({ ...params }).toString()}`;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const composite = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let res;
  try {
    res = await fetch(url, { signal: composite });
  } catch (err) {
    throw new Error(`${safeUrl}: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`);
  }
  if (!res.ok) {
    // Quota exhaustion is 403 with a specific reason and is worth naming — it
    // is the failure a church will actually hit, and "403" alone sends someone
    // hunting for a permissions problem that isn't there.
    const body = await res.json().catch(() => null);
    const reason = body?.error?.errors?.[0]?.reason ?? '';
    if (res.status === 403 && /quota/i.test(reason)) {
      throw new Error('YouTube API daily quota exceeded — viewer counts resume tomorrow (UTC)');
    }
    throw new Error(`${safeUrl}: HTTP ${res.status}${reason ? ` (${reason})` : ''}`);
  }
  return res.json();
}

/**
 * The channel's currently-live video id, or null if nothing is live.
 * This is the expensive call — see the quota note above.
 */
export async function findLiveVideo(channelId, signal) {
  const body = await apiGet(
    'search',
    { part: 'id', channelId, eventType: 'live', type: 'video', maxResults: 1 },
    signal,
  );
  return body?.items?.[0]?.id?.videoId ?? null;
}

/**
 * Live details for a video: { live, viewers, title }.
 * `viewers` is null when the broadcaster has hidden the counter — which is a
 * real configuration, not an error, so it must not read as a failure.
 */
export async function readVideo(videoId, signal) {
  const body = await apiGet(
    'videos',
    { part: 'liveStreamingDetails,snippet', id: videoId },
    signal,
  );
  const item = body?.items?.[0];
  if (!item) return { live: false, viewers: null, title: null };
  const details = item.liveStreamingDetails ?? {};
  // actualEndTime present = the broadcast is over, whatever else it says.
  const live = Boolean(details.actualStartTime) && !details.actualEndTime;
  const raw = details.concurrentViewers;
  return {
    live,
    viewers: raw == null ? null : Number.parseInt(raw, 10),
    title: item.snippet?.title ?? null,
  };
}

// A dev fixture only — see the header. Produces a plausible service curve so
// the widget and report can be developed without a live broadcast, and is
// reachable only from a room that declares `mock: true` in rooms.config.js.
function mockSample(startedAt) {
  const mins = (Date.now() - startedAt) / 60_000;
  const ramp = Math.min(1, mins / 12); // fills up over the first ~12 minutes
  const drift = Math.sin(mins / 3) * 8;
  return { live: true, viewers: Math.max(0, Math.round(70 * ramp + drift + 12)), title: 'Sunday Service (mock)' };
}

/**
 * Emit `onSample({ ts, viewers, videoId, title })` until the signal aborts.
 *
 * Never throws at the caller: a show must not fail because YouTube is
 * unreachable, exactly as with the analysis sources. Failures land in
 * Admin → Health instead.
 */
export async function watchViewers(cfg, onSample, signal, intervalMs = DEFAULT_POLL_MS) {
  const startedAt = Date.now();
  let videoId = cfg.videoId ?? null;
  let resolvedAt = 0;

  while (!signal.aborted) {
    let wait = intervalMs;
    try {
      if (cfg.mock) {
        const m = mockSample(startedAt);
        onSample({ ts: Date.now(), viewers: m.viewers, videoId: 'mock', title: m.title });
      } else {
        // Resolve (or re-resolve) the live video when we have no id, or the
        // cached one has aged out. A configured videoId is never re-resolved.
        if (!cfg.videoId && cfg.channelId && (!videoId || Date.now() - resolvedAt > RESOLVE_TTL_MS)) {
          videoId = await findLiveVideo(cfg.channelId, signal);
          resolvedAt = Date.now();
        }
        if (!videoId) {
          // Nothing live. Not an error — most of the week looks like this.
          report(healthKey(cfg), true);
          onSample(null);
          wait = RESOLVE_RETRY_MS;
        } else {
          const v = await readVideo(videoId, signal);
          report(healthKey(cfg), true);
          if (!v.live) {
            // The broadcast ended — drop the id so the next cycle looks again.
            if (!cfg.videoId) videoId = null;
            onSample(null);
            wait = RESOLVE_RETRY_MS;
          } else {
            onSample({ ts: Date.now(), viewers: v.viewers, videoId, title: v.title });
          }
        }
      }
    } catch (err) {
      if (!signal.aborted) {
        report(healthKey(cfg), false, err.message);
        onSample(null);
        // Back off hard on quota exhaustion: retrying can't help until the
        // daily reset, and each attempt is another (rejected) request.
        wait = /quota/i.test(err.message) ? 30 * 60_000 : Math.max(intervalMs, RESOLVE_RETRY_MS);
      }
    }
    await sleep(wait, signal);
  }
}

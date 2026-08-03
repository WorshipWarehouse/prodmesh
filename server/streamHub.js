// ─────────────────────────────────────────────────────────────────────────────
//  STREAM HUB  —  one SSE connection per browser, many topics.
//
//  Every live datum in the app used to ride one per-room stream carrying one
//  fixed envelope (showManager's `state` event). That shape has two ceilings a
//  dashboard grid would hit immediately:
//
//    • Per-room streams don't compose. A wall display showing six rooms needs
//      six EventSources, and browsers allow only SIX concurrent connections per
//      origin on HTTP/1.1. This is a LAN appliance with no TLS and therefore no
//      HTTP/2 (see the threat model in CLAUDE.md), so that limit is real: the
//      sixth stream simply never opens, silently, and the page half-works.
//    • A fixed envelope can't grow. Every new datum widens one object that then
//      ships to every subscriber whether their widgets render it or not.
//
//  So: a browser opens ONE connection and names the topics it wants.
//
//  The property worth preserving from the old design is watcher refcounting —
//  ProPresenter is not polled for a room nobody is looking at. That is what
//  `start`/`stop` are: the hub calls `start` when a topic gains its first
//  subscriber and `stop` when it loses its last. Feature modules register the
//  topics they own; the hub knows nothing about rooms.
//
//  Wire format: `event: msg`, data `{ topic, data }`. One event name rather
//  than one per topic, so the client attaches a single listener and routes.
// ─────────────────────────────────────────────────────────────────────────────

const registry = []; // { segments: string[], handlers }
const topicSubs = new Map(); // topic -> Set<res>
const subscriberTopics = new Map(); // res -> Set<topic>
const sinks = new Map(); // res -> (topic, data) => void
const retained = new Map(); // topic -> last published data

const HEARTBEAT_MS = 20_000;

/** Topics per connection. A dashboard is a handful of widgets, not hundreds. */
export const MAX_TOPICS = 64;

/**
 * Claim a topic pattern. Segments are ':'-separated; `*` captures one segment.
 *
 *   registerTopic('room:*:spl', { valid, start, stop, snapshot })
 *
 *   valid(params)    — reject topics that parse but name nothing real (an
 *                      unknown room). Subscribing STARTS WORK, so an
 *                      unauthenticated endpoint that accepts any string is a
 *                      resource-exhaustion primitive — this is the same guard
 *                      the show stream grew for exactly that reason.
 *   start(params)    — first subscriber arrived; begin producing.
 *   stop(params)     — last subscriber left; stop producing.
 *   snapshot(params) — current value for a joiner, so a widget mounting
 *                      mid-service paints at once instead of waiting for the
 *                      next change. Without it a joiner sees the last published
 *                      value, and nothing at all if the topic went idle — the
 *                      retained value is dropped when the producer stops, since
 *                      it is by then stale by definition. Any topic whose state
 *                      outlives its viewers (a show runs whether or not anyone
 *                      is watching) therefore needs a snapshot.
 */
export function registerTopic(pattern, handlers) {
  registry.push({ segments: pattern.split(':'), handlers });
}

function resolve(topic) {
  const parts = topic.split(':');
  for (const entry of registry) {
    if (entry.segments.length !== parts.length) continue;
    const params = [];
    let ok = true;
    for (let i = 0; i < parts.length; i += 1) {
      if (entry.segments[i] === '*') params.push(parts[i]);
      else if (entry.segments[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return { handlers: entry.handlers, params };
  }
  return null;
}

/** Is this a topic something actually publishes, naming something real? */
export function isValidTopic(topic) {
  const match = resolve(topic);
  if (!match) return false;
  return match.handlers.valid ? Boolean(match.handlers.valid(...match.params)) : true;
}

function frame(topic, data) {
  return `event: msg\ndata: ${JSON.stringify({ topic, data })}\n\n`;
}

/** Fan a value out to this topic's subscribers and retain it for joiners. */
export function publish(topic, data) {
  retained.set(topic, data);
  const subs = topicSubs.get(topic);
  if (!subs?.size) return;
  for (const res of subs) sinks.get(res)?.(topic, data);
}

/**
 * Attach a response to a set of topics. Unknown/invalid topics are dropped
 * here rather than erroring the whole connection — one stale widget in a saved
 * dashboard must not blank the other eleven.
 *
 * `sink` overrides how values reach this subscriber. The default writes one
 * `msg` frame per value; the legacy per-room show stream uses it to re-shape
 * three topics into the single combined envelope it has always emitted.
 */
export function subscribe(res, topics, sink) {
  const mine = subscriberTopics.get(res) ?? new Set();
  subscriberTopics.set(res, mine);
  if (!sinks.has(res)) sinks.set(res, sink ?? ((topic, data) => res.write(frame(topic, data))));
  for (const topic of topics) {
    if (mine.has(topic) || !isValidTopic(topic)) continue;
    if (mine.size >= MAX_TOPICS) break;
    mine.add(topic);
    let subs = topicSubs.get(topic);
    if (!subs) {
      subs = new Set();
      topicSubs.set(topic, subs);
    }
    subs.add(res);
    const match = resolve(topic);
    // First subscriber starts the producer; only then is a snapshot meaningful.
    if (subs.size === 1) match.handlers.start?.(...match.params);
    const value = match.handlers.snapshot
      ? match.handlers.snapshot(...match.params)
      : retained.get(topic);
    if (value !== undefined) sinks.get(res)(topic, value);
  }
}

/** Detach a response from every topic it holds, stopping now-idle producers. */
export function unsubscribe(res) {
  const mine = subscriberTopics.get(res);
  if (!mine) return;
  subscriberTopics.delete(res);
  sinks.delete(res);
  for (const topic of mine) {
    const subs = topicSubs.get(topic);
    if (!subs) continue;
    subs.delete(res);
    if (subs.size > 0) continue;
    // Drop the entry as well: topicSubs is keyed by strings a client chose, so
    // leaving empty Sets behind is unbounded growth driven from outside.
    topicSubs.delete(topic);
    retained.delete(topic);
    const match = resolve(topic);
    match?.handlers.stop?.(...match.params);
  }
}

/** How many connections hold this topic (tests, and producers deciding to idle). */
export function subscriberCount(topic) {
  return topicSubs.get(topic)?.size ?? 0;
}

/**
 * Turn a response into an SSE stream and wire teardown. Returns nothing — the
 * caller subscribes; `req` closing detaches it. Shared by /api/stream and the
 * legacy per-room show stream so both behave identically on the wire.
 */
export function openStream(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  const hb = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  hb.unref?.();
  req.on('close', () => {
    clearInterval(hb);
    unsubscribe(res);
  });
}

/** Test hook: drop all subscribers, retained values and registrations. */
export function reset() {
  registry.length = 0;
  topicSubs.clear();
  subscriberTopics.clear();
  sinks.clear();
  retained.clear();
}

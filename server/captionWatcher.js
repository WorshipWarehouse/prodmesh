// ─────────────────────────────────────────────────────────────────────────────
//  CAPTION WATCHER  —  one connection per room, however many screens read it.
//
//  Refcounted through the hub like the SPL and video watchers: the socket to
//  the caption app exists only while something is actually displaying the
//  transcript. A stage screen and three booth dashboards cost one connection.
//
//  The published value is a bounded ROLLING WINDOW rather than a delta, because
//  the hub re-sends a topic's current value to every new subscriber — so a
//  stage display that reboots mid-song comes back with the last few lines
//  already on it instead of a blank panel waiting for someone to speak.
// ─────────────────────────────────────────────────────────────────────────────

import { rooms } from './roomsStore.js';
import * as hub from './streamHub.js';
import * as captions from './integrations/captions.js';

const watchers = new Map(); // roomId -> AbortController
const states = new Map(); // roomId -> last published value

/** How many lines to keep. Enough to reread what was just said, not a log. */
const WINDOW = 40;

/** Wait before reconnecting. The caption app is on the same LAN and usually
 *  comes straight back; this only stops a hot loop against a dead port. */
const RETRY_MS = 3000;

export const captionsTopic = (roomId) => `room:${roomId}:captions`;

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    t.unref?.();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Fold one line into the window.
 *
 * A line REPLACES the one with its id rather than appending — that is the
 * whole point of both sources carrying a stable utterance id. Without it a
 * sentence appears once per partial, each a few words longer than the last.
 *
 * Exported because this is the ordering logic worth testing directly.
 */
export function fold(lines, line, limit = WINDOW) {
  const at = lines.findIndex((l) => l.id === line.id);
  if (at === -1) return [...lines, line].slice(-limit);
  // Out-of-order or coalesced partials arrive; an older revision must not
  // overwrite a newer one, and a settled line is never replaced by a live one.
  const prev = lines[at];
  if (!line.live && prev.live) return lines.map((l, i) => (i === at ? line : l));
  if (line.live && !prev.live) return lines;
  if ((line.rev ?? 0) < (prev.rev ?? 0)) return lines;
  return lines.map((l, i) => (i === at ? line : l));
}

/** Only the channels this room cares about, when it has said. */
const allowed = (cfg, ch) => {
  const list = cfg?.channels;
  return !Array.isArray(list) || list.length === 0 || list.includes(String(ch));
};

async function watch(roomId, signal) {
  let value = { up: false, channels: [], lines: [] };
  let last = '';

  const publish = () => {
    const key = JSON.stringify(value);
    if (key === last) return;
    last = key;
    states.set(roomId, value);
    hub.publish(captionsTopic(roomId), value);
  };
  publish();

  while (!signal.aborted) {
    const cfg = rooms[roomId]?.captions;
    if (!captions.isConfigured(cfg)) {
      // Nothing configured is not a fault and never will be on its own — stop
      // rather than reconnect-loop against a room that has no caption app.
      value = { ...value, up: false };
      publish();
      return;
    }

    await captions.watch(cfg, {
      onUp: (up) => {
        // Channels are re-announced on connect, so a reconnect starts from the
        // roster it is actually given rather than a stale one.
        value = up ? { ...value, up: true } : { ...value, up: false, channels: [] };
        publish();
      },
      onChannels: (list) => {
        value = { ...value, channels: list.filter((c) => allowed(cfg, c.ch)) };
        publish();
      },
      onLine: (line) => {
        if (!allowed(cfg, line.ch)) return;
        value = { ...value, lines: fold(value.lines, line) };
        publish();
      },
    }, signal);

    if (signal.aborted) return;
    await sleep(RETRY_MS, signal);
  }
}

function start(roomId) {
  if (watchers.has(roomId) || !rooms[roomId]) return;
  const ctl = new AbortController();
  watchers.set(roomId, ctl);
  watch(roomId, ctl.signal).catch(() => {});
}

function stop(roomId) {
  watchers.get(roomId)?.abort();
  watchers.delete(roomId);
  states.delete(roomId);
}

hub.registerTopic('room:*:captions', {
  valid: (roomId) => Boolean(rooms[roomId]),
  start,
  stop,
  snapshot: (roomId) => states.get(roomId),
});

/** Test hook: stop every watcher. */
export function stopAll() {
  for (const roomId of [...watchers.keys()]) stop(roomId);
}

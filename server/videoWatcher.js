// ─────────────────────────────────────────────────────────────────────────────
//  VIDEO TRANSPORT WATCHER  —  where a playing video is up to.
//
//  Its own topic rather than a field on `room:*:show`, for two reasons:
//
//   1. A video plays OUTSIDE a show. The pre-service loop is the most-watched
//      video of the morning and there is no show running behind it, so
//      anything hung off the show state would be dark exactly when a lobby
//      screen wants it.
//   2. It costs ProPresenter two requests a second. Refcounted through the
//      hub, that cost exists only while a screen is actually showing it —
//      the same bargain the SPL and mode watchers already make.
//
//  Published on change like the mode watcher, except that a playing video
//  changes every poll by definition. What the comparison actually buys is
//  SILENCE while nothing is playing, which is most of the week.
// ─────────────────────────────────────────────────────────────────────────────

import { rooms } from './roomsStore.js';
import * as hub from './streamHub.js';
import * as ppro from './integrations/proPresenter.js';

const watchers = new Map(); // roomId -> AbortController
const states = new Map(); // roomId -> last published value

// One second. The number on screen counts in seconds, so anything faster is
// two requests nobody can see the result of.
const POLL_MS = 1000;

export const videoTopic = (roomId) => `room:${roomId}:video`;

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    t.unref?.(); // an idle watcher must not hold an otherwise-finished process open
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// Whole seconds: the position advances continuously but is DISPLAYED to the
// second, so this is what stops a paused-looking screen from re-rendering 60
// times a minute over sub-second drift.
const changeKey = (v) => (v ? `${v.name}|${v.duration}|${Math.floor(v.seconds ?? -1)}` : '');

async function watch(roomId, signal) {
  let last;
  while (!signal.aborted) {
    let next = null;
    try {
      const pp = rooms[roomId]?.proPresenter;
      // Unreachable ProPresenter publishes null — the same as nothing playing.
      // A screen cannot act on the difference, and readTransport has already
      // reported the failure to the health registry for somebody who can.
      if (ppro.isConfigured(pp)) next = await ppro.readTransport(pp, signal);
    } catch {
      next = null;
    }
    if (signal.aborted) return;
    const key = changeKey(next);
    if (key !== last) {
      last = key;
      states.set(roomId, next);
      hub.publish(videoTopic(roomId), next);
    }
    await sleep(POLL_MS, signal);
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

hub.registerTopic('room:*:video', {
  valid: (roomId) => Boolean(rooms[roomId]),
  start,
  stop,
  snapshot: (roomId) => states.get(roomId),
});

/** Test hook: stop every watcher. */
export function stopAll() {
  for (const roomId of [...watchers.keys()]) stop(roomId);
}

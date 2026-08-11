// ─────────────────────────────────────────────────────────────────────────────
//  LYRICS WATCHER  —  the song ProPresenter is in, and where in it.
//
//  For the people who need to know what is COMING: the director calling a
//  camera on the line before it lands, the volunteer who has never heard the
//  song, the musician whose stage screen only shows the slide that is already
//  up. ProPresenter's own stage display answers "what is on screen now"; this
//  answers "what is on screen now, and what is two lines away".
//
//  Its own topic rather than a field on `room:*:show`, for the reason the video
//  watcher gives: a song plays in rehearsal and on a Thursday with no show
//  running behind it, and anything hung off show state would be dark exactly
//  then.
//
//  ── Cost ───────────────────────────────────────────────────────────────────
//  The whole song arrives in ONE response, so the expensive read happens once
//  per song rather than once per slide: the presentation is cached against its
//  uuid and only re-fetched when ProPresenter moves to a different one. What
//  runs continuously is the slide POSITION, which is a chunked stream plus a
//  small watchdog poll — the arrangement `pollRunState` already proved.
//
//  ── Why the whole song is republished on every slide change ────────────────
//  ~30 cues is a couple of kilobytes and a slide changes every ten seconds or
//  so, which is nothing. What it buys is that this topic stays a complete STATE
//  SNAPSHOT, which is the property that makes the hub's conflation correct: a
//  screen that reconnects mid-song gets the song, not a position into a list it
//  no longer has. Sending deltas here would be a real saving of nothing in
//  exchange for a class of bug.
// ─────────────────────────────────────────────────────────────────────────────

import { rooms } from './roomsStore.js';
import * as hub from './streamHub.js';
import * as ppro from './integrations/proPresenter.js';

const watchers = new Map(); // roomId -> AbortController
const states = new Map(); // roomId -> last published value

// The watchdog, and the only position source on a build whose slide stream is
// unsupported or has dropped. One small GET a second against a box on the same
// switch, and only while somebody is actually reading lyrics. Deliberately not
// relaxed while the stream is trusted the way pollRunState relaxes: this drives
// a scroll a musician is reading, and a second of lag is visible where a slide
// counter's is not.
const POLL_MS = 1000;

/** Before a run of failed polls blanks the song. ProPresenter hiccups, and
 *  clearing the lyrics out from under someone mid-verse for one dropped
 *  request is worse than being three seconds stale. Three consecutive failures
 *  is a real outage. */
const GRACE = 3;

/** Wait before re-opening a dropped slide stream. */
const RETRY_MS = 1000;

export const lyricsTopic = (roomId) => `room:${roomId}:lyrics`;

const EMPTY = { name: null, slides: [], index: null };

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    t.unref?.(); // an idle watcher must not hold an otherwise-finished process open
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function watch(roomId, signal) {
  let value = EMPTY;
  let last = '';
  let cache = { uuid: null, slides: [] };
  let fetching = null;
  let fails = 0;

  const publish = () => {
    const key = JSON.stringify(value);
    if (key === last) return;
    last = key;
    states.set(roomId, value);
    hub.publish(lyricsTopic(roomId), value);
  };
  publish();

  const blank = () => {
    cache = { uuid: null, slides: [] };
    value = EMPTY;
    publish();
  };

  /** Fold one slide_index reading into the published state, fetching the song
   *  behind it if this is a presentation we have not expanded yet. */
  const apply = async (pp, slide) => {
    if (!slide?.presUuid) return blank();

    if (cache.uuid !== slide.presUuid) {
      // One fetch in flight at a time. The stream and the watchdog both land
      // here, and two requests for the same song would be pure waste.
      if (!fetching) {
        const want = slide.presUuid;
        fetching = (async () => {
          const pres = await ppro.readActivePresentation(pp, signal);
          // Which arrangement is playing. PP 21.4 answers with total_cues on
          // slide_index; 21.1 has no total_cues and leaves current_arrangement
          // empty, so the only source is the active playlist item — an extra
          // request, but once per song rather than once per slide.
          let arrangement = null;
          if (slide.totalCues == null) {
            arrangement = await ppro
              .readActive(pp, signal, slide)
              .then((item) => ({ uuid: item.arrangementUuid, name: item.arrangementName }))
              .catch(() => null);
          }
          cache = { uuid: want, slides: ppro.arrangeSlides(pres, arrangement, slide.totalCues) };
        })()
          .catch(() => { cache = { uuid: want, slides: [] }; })
          .finally(() => { fetching = null; });
      }
      await fetching;
      // The operator may have moved on while that was in the air — the fetch
      // that lands is not necessarily the one this reading wanted. Drop it and
      // let the next poll (≤1s) fetch the song we are actually on.
      if (cache.uuid !== slide.presUuid) return;
    }

    value = { name: slide.presName ?? null, slides: cache.slides, index: slide.slideIndex };
    publish();
  };

  // Push side. Sub-second when the build supports it, and silent when it does
  // not — an unsupported stream is an expected answer, not an outage, and the
  // watchdog below is a complete position source on its own.
  (async () => {
    while (!signal.aborted) {
      const pp = rooms[roomId]?.proPresenter;
      if (ppro.isConfigured(pp)) {
        try {
          await ppro.streamSlideIndex(pp, (slide) => { apply(pp, slide).catch(() => {}); }, signal);
        } catch { /* not supported, or dropped — the watchdog carries it */ }
      }
      if (signal.aborted) return;
      await sleep(RETRY_MS, signal);
    }
  })();

  while (!signal.aborted) {
    const pp = rooms[roomId]?.proPresenter;
    if (!ppro.isConfigured(pp)) {
      blank();
    } else {
      try {
        await apply(pp, await ppro.readSlide(pp, signal));
        fails = 0;
      } catch {
        fails += 1;
        if (fails >= GRACE) blank();
      }
    }
    if (signal.aborted) return;
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

hub.registerTopic('room:*:lyrics', {
  valid: (roomId) => Boolean(rooms[roomId]),
  start,
  stop,
  snapshot: (roomId) => states.get(roomId),
});

/** Test hook: stop every watcher. */
export function stopAll() {
  for (const roomId of [...watchers.keys()]) stop(roomId);
}

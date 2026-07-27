// ─────────────────────────────────────────────────────────────────────────────
//  SHOW MANAGER  —  the server is the authoritative coordinator.
//
//  A "show" is a live service session: at most ONE active per room. While a show
//  is active the server runs a single ProPresenter poller for the room, tracks
//  the current item + slide progress, records the timeline, and fans state out to
//  every subscribed browser over SSE. Browsers are pure views: Start/End/override
//  are server actions that all views reflect instantly. Recording is tied to the
//  show, not to any browser being open.
//
//  Active shows are persisted (server/data/shows/) and restored on boot.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeJsonAtomic } from './atomicFile.js';

import { rooms } from './roomsStore.js';
import { onConnectivityChange } from './connectivity.js';
import * as ppro from './integrations/proPresenter.js';
import * as pco from './integrations/planningCenter.js';
import * as analysis from './integrations/analysis.js';
import * as timeline from './timeline.js';
import * as splStore from './splStore.js';
import * as summaries from './showSummaries.js';
import * as showConfig from './showConfig.js';
import { armWindow, pickAutostartTime, shouldAutostart, shouldAutoComplete, armsAutoComplete } from './autoShow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOWS_DIR = join(process.env.PRODMESH_DATA_DIR ?? join(__dirname, 'data'), 'shows');

const shows = new Map(); // roomId -> runtime show (only while active)
const subscribers = new Map(); // roomId -> Set<res> (persists across show start/end)
const timers = new Map(); // roomId -> published PP timer state (or null)
const timerWatchers = new Map(); // roomId -> AbortController (runs while subscribed)
const spls = new Map(); // roomId -> published SPL state (or null)
const splWatchers = new Map(); // roomId -> AbortController (runs while subscribed)

const instanceId = (show) => `${show.planId}__${show.timeId}`;
const showFile = (roomId) => join(SHOWS_DIR, `${roomId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);

// ── Public state + SSE fan-out ────────────────────────────────────────────────
export function getState(roomId) {
  const timer = timers.get(roomId) ?? null;
  const spl = spls.get(roomId) ?? null;
  const show = shows.get(roomId);
  if (!show) return { active: false, timer, spl };
  return {
    active: true,
    roomId,
    planId: show.planId,
    timeId: show.timeId,
    startedAt: show.startedAt,
    follow: show.follow,
    ppConnected: show.ppConnected,
    current: show.current,
    timer,
    spl,
  };
}

function subs(roomId) {
  if (!subscribers.has(roomId)) subscribers.set(roomId, new Set());
  return subscribers.get(roomId);
}

function broadcast(roomId) {
  const data = `event: state\ndata: ${JSON.stringify(getState(roomId))}\n\n`;
  for (const res of subs(roomId)) res.write(data);
}

export function subscribe(roomId, res) {
  subs(roomId).add(res);
  res.write(`event: state\ndata: ${JSON.stringify(getState(roomId))}\n\n`);
  startTimerWatcher(roomId);
  startSplWatcher(roomId);
}

export function unsubscribe(roomId, res) {
  subs(roomId).delete(res);
  if (subs(roomId).size === 0) {
    stopTimerWatcher(roomId);
    stopSplWatcher(roomId);
    // Drop the entry too. subs() creates a Set for ANY key, so leaving empty
    // ones behind meant one permanent Map entry per distinct roomId ever
    // requested — unbounded growth driven by an unauthenticated endpoint.
    subscribers.delete(roomId);
  }
}

// ── PP timer watcher ─────────────────────────────────────────────────────────
//  The room's "Service Start Timer" counts down BETWEEN services (a Message
//  re-targets + starts it), so it can't be tied to an active show. It runs
//  whenever the room has at least one subscribed view, and stops when the last
//  view disconnects — no PP polling for rooms nobody is looking at.

function startTimerWatcher(roomId) {
  if (timerWatchers.has(roomId)) return;
  const pp = rooms[roomId]?.proPresenter;
  if (!ppro.isConfigured(pp)) return;
  const ctl = new AbortController();
  timerWatchers.set(roomId, ctl);
  watchTimers(roomId, pp, ctl.signal).catch(() => {});
}

function stopTimerWatcher(roomId) {
  timerWatchers.get(roomId)?.abort();
  timerWatchers.delete(roomId);
  timers.delete(roomId);
}

function timerSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    // Detach the abort listener when the timer fires normally — long-lived
    // signals (the autostart watcher's never-aborting one) would otherwise
    // accumulate one listener per sleep, forever.
    const onAbort = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    t.unref?.(); // idle watchers must not hold an otherwise-finished process open
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ── SPL watcher ──────────────────────────────────────────────────────────────
//  Unlike the (display-only) timer watcher, SPL feeds the Show Report — so it
//  runs while the room has subscribers OR an active show. Samples persist to
//  SQLite only while a show is live; the live meter is broadcast either way.

function splNeeded(roomId) {
  return subs(roomId).size > 0 || shows.has(roomId);
}

function startSplWatcher(roomId) {
  if (splWatchers.has(roomId)) return;
  const cfg = rooms[roomId]?.analysis;
  if (!analysis.isConfigured(cfg)) return;
  const ctl = new AbortController();
  splWatchers.set(roomId, ctl);
  analysis.watchSpl(cfg, (s) => onSpl(roomId, s), ctl.signal).catch(() => {
    if (!ctl.signal.aborted) {
      spls.set(roomId, null);
      broadcast(roomId);
    }
  });
}

function stopSplWatcher(roomId) {
  if (splNeeded(roomId)) return; // still wanted by a show or a viewer
  splWatchers.get(roomId)?.abort();
  splWatchers.delete(roomId);
  spls.delete(roomId);
}

// ── Live config edits ────────────────────────────────────────────────────────
//  Watchers capture the room's config object when they start, so a
//  connectivity save must restart any that are running — including starting
//  one that couldn't run before (the room just gained a host).

function restartSplWatcher(roomId) {
  splWatchers.get(roomId)?.abort();
  splWatchers.delete(roomId);
  spls.delete(roomId);
  const show = shows.get(roomId);
  if (show && !show.splStats && analysis.isConfigured(rooms[roomId]?.analysis)) {
    show.splStats = splStore.runningStats(instanceId(show)); // start recording mid-show
  }
  if (splNeeded(roomId)) startSplWatcher(roomId);
  broadcast(roomId);
}

function restartTimerWatcher(roomId) {
  timerWatchers.get(roomId)?.abort();
  timerWatchers.delete(roomId);
  timers.delete(roomId);
  if (subs(roomId).size > 0) startTimerWatcher(roomId);
  broadcast(roomId);
}

function restartPoller(show) {
  show.abort.abort();
  show.abort = new AbortController();
  show.ppConnected = null;
  startPoller(show);
}

onConnectivityChange((roomId, integration) => {
  if (integration === 'analysis') restartSplWatcher(roomId);
  if (integration === 'proPresenter') {
    restartTimerWatcher(roomId);
    const show = shows.get(roomId);
    if (show) restartPoller(show);
  }
  // planningCenter/companion need nothing: their consumers (plan lookups, mode
  // reads, the autostart loop) re-read the rooms map on every use.
});

// ── Smaart SPL logging control ───────────────────────────────────────────────
//  With analysis.logControl set, a show turns Smaart's SPL logging on at start
//  and back off at end — but off only when the dashboard was the one who
//  started it, so an engineer's manually-running log session survives a show.
//  Fire-and-forget: a show must never fail because Smaart is unreachable.

function startShowLogging(show) {
  const cfg = rooms[show.roomId]?.analysis;
  if (!cfg?.logControl || !analysis.supportsLogControl(cfg)) return;
  analysis
    .setLogging(cfg, true)
    .then(({ changed }) => {
      if (!changed || !shows.has(show.roomId)) return;
      show.startedLogging = true;
      persistShow(show); // survive a mid-show server restart
      console.log(`[smaart] ${cfg.host}: SPL logging started for show`);
    })
    .catch((err) => console.error(`[smaart] ${cfg.host}: could not start SPL logging — ${err.message}`));
}

function stopShowLogging(show) {
  const cfg = rooms[show.roomId]?.analysis;
  if (!show.startedLogging || !cfg?.logControl || !analysis.supportsLogControl(cfg)) return;
  analysis
    .setLogging(cfg, false)
    .then(() => console.log(`[smaart] ${cfg.host}: SPL logging stopped after show`))
    .catch((err) => console.error(`[smaart] ${cfg.host}: could not stop SPL logging — ${err.message}`));
}

function onSpl(roomId, sample) {
  const cfg = rooms[roomId]?.analysis ?? {};
  const show = shows.get(roomId);
  let avg = null;
  let peak = null;
  let caAvg = null;
  let caMax = null;
  if (show && show.splStats) {
    splStore.record(roomId, instanceId(show), sample.ts, sample.spl, sample.ca ?? null);
    const st = show.splStats;
    st.n += 1;
    st.sumEnergy += 10 ** (sample.spl / 10);
    st.peak = st.peak == null ? sample.spl : Math.max(st.peak, sample.spl);
    avg = splStore.round1(10 * Math.log10(st.sumEnergy / st.n));
    peak = splStore.round1(st.peak);
    if (sample.ca != null) {
      st.caN = (st.caN ?? 0) + 1;
      st.caSum = (st.caSum ?? 0) + sample.ca;
      st.caMax = st.caMax == null ? sample.ca : Math.max(st.caMax, sample.ca);
    }
    if (st.caN) {
      caAvg = splStore.round1(st.caSum / st.caN);
      caMax = splStore.round1(st.caMax);
    }
  }
  spls.set(roomId, {
    current: sample.spl,
    avg,
    peak,
    target: cfg.target ?? null,
    limit: cfg.limit ?? null,
    // C-A ratio rides along when the analysis source provides it (RTA).
    // Its target band comes from the analyzer app's own config.
    ca:
      sample.ca != null
        ? {
            current: sample.ca,
            avg: caAvg,
            max: caMax,
            lo: sample.caBand?.lo ?? null,
            hi: sample.caBand?.hi ?? null,
          }
        : null,
  });
  broadcast(roomId);
}

async function watchTimers(roomId, pp, signal) {
  let lastKey;
  while (!signal.aborted) {
    let next = null;
    try {
      const all = await ppro.readTimers(pp, signal);
      next = ppro.pickTimer(all, pp.timer ?? null);
    } catch {
      next = null; // PP unreachable → no timer shown
    }
    if (signal.aborted) return;
    const key = next ? `${next.uuid}|${next.state}|${next.remainingSeconds}` : 'none';
    if (key !== lastKey) {
      lastKey = key;
      timers.set(roomId, next);
      broadcast(roomId);
    }
    await timerSleep(next ? 1000 : 5000, signal); // back off while PP is offline
  }
}

// ── Persistence ───────────────────────────────────────────────────────────────
function persistShow(show) {
  writeJsonAtomic(showFile(show.roomId), {
    roomId: show.roomId,
    planId: show.planId,
    timeId: show.timeId,
    startedAt: show.startedAt,
    startedLogging: show.startedLogging ?? false,
    status: 'active',
    // The hydrated order of service, so a mid-show server restart during a
    // Planning Center outage restores with its item list intact (PP→item
    // mapping and timing capture keep working).
    items: show.items,
  });
}

function removeShowFile(roomId) {
  const f = showFile(roomId);
  if (existsSync(f)) unlinkSync(f);
}

// ── Plan lookup ─────────────────────────────────────────────────────────────
async function findPlan(room, planId) {
  for (const st of room.planningCenter?.serviceTypes ?? []) {
    const plans = await pco.getUpcomingPlans(st, 10).catch(() => []);
    const p = plans.find((x) => x.id === planId);
    if (p) return p;
  }
  return null;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
async function beginShow(roomId, planId, timeId, startedAt, { startedLogging = false, fallbackItems = [] } = {}) {
  const room = rooms[roomId];
  if (!room) throw new Error('Unknown room');

  // Base identity first, unconditionally — even if the plan can't be resolved
  // (PC down, plan aged out), the timeline and its history row still know
  // whose show this was. Labels are layered on below when the plan is found.
  timeline.ensure(`${planId}__${timeId}`, { roomId, planId, timeId });

  let items = [];
  try {
    const plan = await findPlan(room, planId);
    if (plan) {
      const st = { id: plan.serviceTypeId, name: plan.serviceTypeName };
      items = await pco.getPlanItems(st, plan.id);
      // Label the timeline now, while the plan is easy to resolve — the
      // history page reads these long after the plan has left "upcoming".
      const time = await pco.getPlanTimes(st, plan.id).then(
        (ts) => ts.find((t) => t.id === timeId) ?? null,
        () => null,
      );
      timeline.ensure(`${planId}__${timeId}`, {
        roomId,
        planId,
        timeId,
        planTitle: plan.title,
        serviceTypeName: plan.serviceTypeName,
        dates: plan.dates,
        timeName: time?.name ?? null,
        timeStartsAt: time?.startsAt ?? null,
      });
    }
  } catch {
    /* items stay [] */
  }

  // Plan unavailable (PCO outage, plan aged out) but we have a persisted copy
  // from when this show originally started — run on that instead of nothing.
  if (!items.length && fallbackItems.length) {
    items = fallbackItems;
    console.log(
      `[show] ${roomId}: Planning Center unavailable — using persisted order of service (${items.length} items)`,
    );
  }

  const show = {
    roomId,
    planId,
    timeId,
    startedAt,
    items,
    itemById: new Map(items.map((i) => [i.id, i])),
    current: { itemId: null, itemIndex: null, itemName: null, slideIndex: null, slideCount: null },
    follow: true,
    ppConnected: null,
    config: showConfig.getConfig(roomId, planId), // per-event automation settings
    startedLogging, // true when the dashboard turned Smaart's SPL logging on
    abort: new AbortController(),
  };
  shows.set(roomId, show);
  timeline.reopen(instanceId(show)); // restarting an ended show un-completes it
  summaries.refresh(instanceId(show)); // history reflects the (re)start immediately
  // Seed running SPL stats from any samples already recorded (reopened show).
  if (analysis.isConfigured(room.analysis)) show.splStats = splStore.runningStats(instanceId(show));
  persistShow(show);
  broadcast(roomId);
  startPoller(show);
  startSplWatcher(roomId); // capture runs with the show, not the browsers
  startShowLogging(show);
  return show;
}

/** Instance ids of currently-live shows (their summary rows may be stale). */
export function activeInstanceIds() {
  return [...shows.values()].map(instanceId);
}

export async function startShow(roomId, planId, timeId = 'default') {
  const existing = shows.get(roomId);
  if (existing) {
    const err = new Error('A show is already active in this room');
    err.code = 'conflict';
    throw err;
  }
  await beginShow(roomId, planId, timeId, Date.now());
  return getState(roomId);
}

export function endShow(roomId) {
  const show = shows.get(roomId);
  if (!show) {
    const err = new Error('No active show in this room');
    err.code = 'not_found';
    throw err;
  }
  show.abort.abort();
  timeline.finalize(instanceId(show));
  summaries.refresh(instanceId(show)); // the summary row is stamped at show end
  shows.delete(roomId);
  removeShowFile(roomId);
  stopSplWatcher(roomId); // no-op if viewers still want the live meter
  stopShowLogging(show);
  broadcast(roomId);
  return getState(roomId);
}

/** Manual override (set current item) and/or toggle follow. */
export function setCurrent(roomId, { itemId, follow } = {}) {
  const show = shows.get(roomId);
  if (!show) {
    const err = new Error('No active show in this room');
    err.code = 'not_found';
    throw err;
  }
  if (typeof follow === 'boolean') show.follow = follow;
  if (itemId) {
    show.follow = false; // a manual pick overrides follow
    const idx = show.items.findIndex((i) => i.id === itemId);
    applyCurrent(show, itemId, show.itemById.get(itemId)?.title, idx >= 0 ? idx : null);
  }
  broadcast(roomId);
  return getState(roomId);
}

// ── Poller + recording ────────────────────────────────────────────────────────
function startPoller(show) {
  const pp = rooms[show.roomId]?.proPresenter;
  if (!ppro.isConfigured(pp)) {
    show.ppConnected = false;
    broadcast(show.roomId);
    return;
  }
  ppro
    .pollRunState(pp, (s) => onPoll(show, s), show.abort.signal, SHOW_POLL_MS)
    .catch(() => {
      if (!show.abort.signal.aborted) {
        show.ppConnected = false;
        broadcast(show.roomId);
      }
    });
}

function onPoll(show, s) {
  show.ppConnected = true;
  show.current.slideIndex = s.slideIndex;
  show.current.slideCount = s.slideCount;
  if (show.follow) {
    const itemId = ppro.mapActiveToItemId(
      show.items,
      { index: s.itemIndex, name: s.itemName },
      show.config?.map,
    );
    if (itemId) applyCurrent(show, itemId, s.itemName, s.itemIndex);
    // Auto-complete: last slide of the configured end item. Follow mode only —
    // in manual override, current.itemId no longer describes what PP is
    // showing, so slide position would be meaningless here. Edge-triggered:
    // the end item must be seen midway first (see autoShow.js — PP flashes a
    // re-triggered item's stored slide, which can be the last one).
    if (show.current.itemId !== show.config?.endItemId) show.endArmed = false;
    else if (armsAutoComplete(show.config, show.current)) show.endArmed = true;
    if (shouldAutoComplete(show.config, show.current, show.endArmed)) {
      endShow(show.roomId);
      return;
    }
  }
  broadcast(show.roomId);
}

// Set the current item and record the transition (once) into the timeline.
function applyCurrent(show, itemId, fallbackName, index) {
  const pc = show.itemById.get(itemId);
  const name = pc?.title ?? fallbackName ?? null;
  show.current.itemId = itemId;
  show.current.itemIndex = index ?? null;
  show.current.itemName = name;
  timeline.recordActive(
    instanceId(show),
    { roomId: show.roomId, planId: show.planId, timeId: show.timeId },
    { itemId, itemName: name, itemIndex: index, plannedLength: pc?.length ?? null },
  );
}

/** A live show picks up config edits made on the Event Detail page. */
export function refreshConfig(roomId, planId) {
  const show = shows.get(roomId);
  if (show && show.planId === planId) {
    show.config = showConfig.getConfig(roomId, planId);
    broadcast(roomId);
  }
}

// ── Autostart watcher ────────────────────────────────────────────────────────
//  Per room, for the server's lifetime, with zero browsers required. Cheap
//  when idle: once a minute it checks whether the room's next event has a
//  startItemId configured AND the clock is inside the arm window (2h before
//  the first service time → 1h after the last). Only then does it poll
//  ProPresenter, and only a TRANSITION onto the start item begins the show —
//  "Pre-Service Slides" can loop all it wants between services.

// Dev-only: PRODMESH_AUTOSTART_TEST=1 arms configured events regardless of
// the clock, so autostart can be exercised outside the Sunday window. Never
// set this in production — it would let a Tuesday rehearsal start a show.
// PRODMESH_AUTOSTART_ARM_MS / PRODMESH_AUTOSTART_POLL_MS /
// PRODMESH_SHOW_POLL_MS override the loop cadences so tests can run in
// milliseconds; unset (production) they default to the real values and are
// inert.
const IGNORE_WINDOW = process.env.PRODMESH_AUTOSTART_TEST === '1';
const envMs = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const ARM_CHECK_MS = envMs('PRODMESH_AUTOSTART_ARM_MS', 60 * 1000);
const PP_POLL_MS = envMs('PRODMESH_AUTOSTART_POLL_MS', 3000);
const SHOW_POLL_MS = envMs('PRODMESH_SHOW_POLL_MS', 800);

export async function nextArmedEvent(room, now) {
  const plans = [];
  for (const st of room.planningCenter?.serviceTypes ?? []) {
    plans.push(...(await pco.getUpcomingPlans(st, 3).catch(() => [])));
  }
  plans.sort((a, b) => String(a.sortDate ?? '').localeCompare(String(b.sortDate ?? '')));
  for (const plan of plans) {
    const config = showConfig.getConfig(room.id, plan.id);
    if (!config?.startItemId) continue;
    const st = { id: plan.serviceTypeId, name: plan.serviceTypeName };
    const times = await pco.getPlanTimes(st, plan.id).catch(() => []);
    const window = armWindow(times);
    if (!IGNORE_WINDOW && (!window || now < window.from || now > window.to)) continue;
    const items = await pco.getPlanItems(st, plan.id).catch(() => []);
    if (items.length === 0) continue;
    return { plan, config, times, items };
  }
  return null;
}

async function autostartLoop(roomId, signal) {
  let prevItemId = null; // last mapped PC item; null = no baseline (never trigger)
  let armedPlanId = null; // for state-change logging only
  while (!signal.aborted) {
    // Connectivity AND the room itself are edited live, so eligibility is
    // per-cycle, not per-boot: a room gains (or loses) autostart within a
    // minute of a config save, and a topology rebuild swaps the room object.
    const room = rooms[roomId];
    const pp = room?.proPresenter;
    if (!room || !ppro.isConfigured(pp) || !(room.planningCenter?.serviceTypes ?? []).length) {
      prevItemId = null;
      await timerSleep(ARM_CHECK_MS, signal);
      continue;
    }
    let armed = null;
    if (!shows.has(roomId)) {
      try {
        armed = await nextArmedEvent(room, Date.now());
      } catch {
        armed = null;
      }
    }
    if ((armed?.plan.id ?? null) !== armedPlanId) {
      armedPlanId = armed?.plan.id ?? null;
      console.log(`[autostart] ${roomId}: ${armedPlanId ? `armed for plan ${armedPlanId}` : 'disarmed'}`);
    }
    if (!armed) {
      prevItemId = null;
      await timerSleep(ARM_CHECK_MS, signal);
      continue;
    }
    // Armed: watch PP until the arm window closes, a show starts, or ~1 min
    // passes (then re-evaluate which event is armed).
    for (let i = 0; i < ARM_CHECK_MS / PP_POLL_MS && !signal.aborted && !shows.has(roomId); i++) {
      let itemId = null;
      try {
        const active = await ppro.readActive(pp, signal);
        itemId = ppro.mapActiveToItemId(armed.items, active, armed.config.map);
      } catch {
        prevItemId = null; // PP unreachable → drop the baseline
        await timerSleep(PP_POLL_MS, signal);
        continue;
      }
      if (itemId !== prevItemId && itemId != null) {
        console.log(`[autostart] ${roomId}: PP moved ${prevItemId ?? '(none)'} → ${itemId}`);
      }
      if (shouldAutostart(armed.config, prevItemId, itemId)) {
        const isCompleted = (timeId) =>
          Boolean(timeline.getReport(`${armed.plan.id}__${timeId}`)?.completedAt);
        const timeId = pickAutostartTime(armed.times, Date.now(), isCompleted);
        if (timeId) {
          try {
            await startShow(roomId, armed.plan.id, timeId);
            console.log(`[autostart] ${roomId}: show started for ${armed.plan.id}__${timeId}`);
          } catch {
            /* conflict — someone started it manually first */
          }
        }
      }
      // PP quirk (verified live): playlist_item reads null for a beat right
      // after an item trigger, until the next slide action. Only a MAPPED item
      // updates the baseline — otherwise pre-service → (null) → worship would
      // swallow the transition and autostart would never fire.
      if (itemId != null) prevItemId = itemId;
      await timerSleep(PP_POLL_MS, signal);
    }
  }
}

const autostartWatchers = new Map(); // roomId -> AbortController

function startAutostartWatcher(roomId) {
  if (autostartWatchers.has(roomId)) return;
  const ctl = new AbortController();
  autostartWatchers.set(roomId, ctl);
  // Every room gets a watcher — the loop itself checks (each minute) whether
  // the room currently has ProPresenter + service types, so connectivity
  // edits enable/disable autostart without a restart.
  // A watcher must never die silently — it's the thing nobody is looking at.
  autostartLoop(roomId, ctl.signal).catch((err) => {
    console.error(`[autostart] ${roomId}: watcher crashed — ${err?.stack ?? err}`);
  });
}

/** Start the per-room autostart watchers (called once at boot). */
export function initAutomation() {
  if (IGNORE_WINDOW) {
    console.warn('[autostart] PRODMESH_AUTOSTART_TEST=1 — arm window IGNORED (dev/testing only)');
  }
  syncAutomation();
}

/** Reconcile per-room work with the rooms map after a topology save: rooms
 *  created in Admin → Campuses gain a watcher, deleted rooms lose all their
 *  live work (watchers, streams, an active show). */
export function syncAutomation() {
  for (const [roomId, ctl] of autostartWatchers) {
    if (rooms[roomId]) continue;
    ctl.abort();
    autostartWatchers.delete(roomId);
    if (shows.has(roomId)) {
      try { endShow(roomId); } catch { /* already gone */ }
    }
    timerWatchers.get(roomId)?.abort();
    timerWatchers.delete(roomId);
    timers.delete(roomId);
    splWatchers.get(roomId)?.abort();
    splWatchers.delete(roomId);
    spls.delete(roomId);
  }
  for (const room of Object.values(rooms)) startAutostartWatcher(room.id);
}

// ── Boot restore ────────────────────────────────────────────────────────────
export async function restoreShows() {
  if (!existsSync(SHOWS_DIR)) return;
  for (const f of readdirSync(SHOWS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const meta = JSON.parse(readFileSync(join(SHOWS_DIR, f), 'utf8'));
      if (meta.status === 'active' && meta.roomId && meta.planId && !shows.has(meta.roomId)) {
        await beginShow(meta.roomId, meta.planId, meta.timeId ?? 'default', meta.startedAt ?? Date.now(), {
          startedLogging: Boolean(meta.startedLogging),
          fallbackItems: Array.isArray(meta.items) ? meta.items : [],
        });
      }
    } catch {
      /* skip bad file */
    }
  }
}

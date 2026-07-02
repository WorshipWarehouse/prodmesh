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

import { rooms } from './rooms.config.js';
import * as ppro from './integrations/proPresenter.js';
import * as pco from './integrations/planningCenter.js';
import * as smaart from './integrations/smaart.js';
import * as timeline from './timeline.js';
import * as splStore from './splStore.js';

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
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
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
  const cfg = rooms[roomId]?.smaart;
  if (!smaart.isConfigured(cfg)) return;
  const ctl = new AbortController();
  splWatchers.set(roomId, ctl);
  smaart.watchSpl(cfg, (s) => onSpl(roomId, s), ctl.signal).catch(() => {
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

function onSpl(roomId, sample) {
  const cfg = rooms[roomId]?.smaart ?? {};
  const show = shows.get(roomId);
  let avg = null;
  let peak = null;
  if (show && show.splStats) {
    splStore.record(roomId, instanceId(show), sample.ts, sample.spl);
    const st = show.splStats;
    st.n += 1;
    st.sumEnergy += 10 ** (sample.spl / 10);
    st.peak = st.peak == null ? sample.spl : Math.max(st.peak, sample.spl);
    avg = splStore.round1(10 * Math.log10(st.sumEnergy / st.n));
    peak = splStore.round1(st.peak);
  }
  spls.set(roomId, {
    current: sample.spl,
    avg,
    peak,
    target: cfg.target ?? null,
    limit: cfg.limit ?? null,
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
    status: 'active',
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
async function beginShow(roomId, planId, timeId, startedAt) {
  const room = rooms[roomId];
  if (!room) throw new Error('Unknown room');

  let items = [];
  try {
    const plan = await findPlan(room, planId);
    if (plan) items = await pco.getPlanItems({ id: plan.serviceTypeId, name: plan.serviceTypeName }, plan.id);
  } catch {
    /* items stay [] */
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
    abort: new AbortController(),
  };
  shows.set(roomId, show);
  timeline.reopen(instanceId(show)); // restarting an ended show un-completes it
  // Seed running SPL stats from any samples already recorded (reopened show).
  if (smaart.isConfigured(room.smaart)) show.splStats = splStore.runningStats(instanceId(show));
  persistShow(show);
  broadcast(roomId);
  startPoller(show);
  startSplWatcher(roomId); // capture runs with the show, not the browsers
  return show;
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
  shows.delete(roomId);
  removeShowFile(roomId);
  stopSplWatcher(roomId); // no-op if viewers still want the live meter
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
    .pollRunState(pp, (s) => onPoll(show, s), show.abort.signal)
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
    const itemId = ppro.mapIndexToItemId(show.items, { index: s.itemIndex, name: s.itemName });
    if (itemId) applyCurrent(show, itemId, s.itemName, s.itemIndex);
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

// ── Boot restore ────────────────────────────────────────────────────────────
export async function restoreShows() {
  if (!existsSync(SHOWS_DIR)) return;
  for (const f of readdirSync(SHOWS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const meta = JSON.parse(readFileSync(join(SHOWS_DIR, f), 'utf8'));
      if (meta.status === 'active' && meta.roomId && meta.planId && !shows.has(meta.roomId)) {
        await beginShow(meta.roomId, meta.planId, meta.timeId ?? 'default', meta.startedAt ?? Date.now());
      }
    } catch {
      /* skip bad file */
    }
  }
}

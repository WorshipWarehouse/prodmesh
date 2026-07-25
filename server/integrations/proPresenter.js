// ─────────────────────────────────────────────────────────────────────────────
//  INTEGRATION: ProPresenter (official API, 7.9+)  —  live Run of Show tracking
//
//  The PC plan is pushed into ProPresenter as a playlist, so the active playlist
//  item maps 1:1 (by index) to our PC order of service. We stream the active
//  item via /v1/playlist/active?chunked=true and relay it to browsers over SSE.
//
//  Per-room host/port (ProPresenter picks an ephemeral API port). No auth (LAN).
// ─────────────────────────────────────────────────────────────────────────────

import { report } from '../health.js';

const DEFAULT_PORT = 62202;

export const isConfigured = (pp) => Boolean(pp?.host);

function baseUrl(pp) {
  return `http://${pp.host}:${pp.port ?? DEFAULT_PORT}`;
}

// ── Mapping (pure, tested) ────────────────────────────────────────────────────

// The playlist-item shape this module hands to callers, from a raw
// `playlist_item` body (same nesting in /v1/playlist/active, /v1/playlist/
// focused, and playlist item listings): fields under `.id`, the active
// arrangement (which the presentation's own `current_arrangement` does NOT
// reliably report) under `.presentation_info`.
function itemShape(pli, playlistName) {
  const id = pli?.id ?? null;
  const info = pli?.presentation_info ?? {};
  return {
    index: id?.index ?? null,
    name: id?.name ?? null,
    uuid: id?.uuid ?? null,
    arrangementUuid: info.arrangement_uuid || null,
    arrangementName: info.arrangement_name || null,
    playlistName: playlistName ?? null,
  };
}

// Extract the active presentation playlist item from a /v1/playlist/active body.
export function parseActive(state) {
  const p = state?.presentation ?? {};
  return itemShape(p.playlist_item ?? null, p.playlist?.name ?? null);
}

const norm = (s) =>
  String(s ?? '').toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/[^a-z0-9]/g, '');

// Tolerant name match — PP/PC titles differ in spacing/case/suffixes
// ("Break Out" vs "Breakout", "Pre Service" vs "Pre-Service Slides").
function namesMatch(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x) || x.includes(y) || y.includes(x);
}

/**
 * Map ProPresenter's active item to a PC order-of-service item id.
 * Index is primary (the PC push preserves order); name is the sanity check
 * and the fallback when counts have diverged.
 */
export function mapIndexToItemId(items, active) {
  if (!active || active.index == null) return null;
  const at = items[active.index];
  if (at && namesMatch(at.title, active.name)) return at.id;
  const byName = items.find((it) => namesMatch(it.title, active.name));
  if (byName) return byName.id;
  return at ? at.id : null; // trust index even if names differ
}

/**
 * Mapping with per-event manual overrides layered on top (Event Detail →
 * Show Config): overrides = { '<pc item id>': { ppIndex, ppName } }. An
 * override wins by playlist index, with a tolerant-name rescue for when the
 * playlist was re-pushed and indices shifted but names survived.
 */
export function mapActiveToItemId(items, active, overrides = null) {
  if (!active || active.index == null) return null;
  if (overrides) {
    for (const [pcId, pp] of Object.entries(overrides)) {
      if (pp == null) continue;
      if (pp.ppIndex === active.index || (pp.ppName && namesMatch(pp.ppName, active.name))) {
        return pcId;
      }
    }
    // A PP item claimed by an override must not ALSO auto-map elsewhere…
    const auto = mapIndexToItemId(items, active);
    // …and a PC item claimed by an override must not be reachable by auto-map
    // from a different PP item (the override redirected it on purpose).
    if (auto && Object.prototype.hasOwnProperty.call(overrides, auto) && overrides[auto] != null) {
      return null;
    }
    return auto;
  }
  return mapIndexToItemId(items, active);
}

// ── Reads ─────────────────────────────────────────────────────────────────────

function withTimeout(signal, ms = 3000) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// All reads funnel through here; the room isn't known at this depth, so health
// is keyed by the machine we actually talked to.
export const healthKey = (pp) => `proPresenter@${pp.host}:${pp.port ?? DEFAULT_PORT}`;

async function ppGet(pp, path, signal) {
  const key = healthKey(pp);
  try {
    const res = await fetch(`${baseUrl(pp)}${path}`, { signal: withTimeout(signal) });
    if (!res.ok) throw new Error(`ProPresenter ${res.status}`);
    const body = await res.json();
    report(key, true);
    return body;
  } catch (err) {
    // A caller abort (show ended, view closed) is not an integration failure;
    // an unresponsive PP surfaces as TimeoutError and is.
    if (err?.name !== 'AbortError') report(key, false, String(err.message ?? err));
    throw err;
  }
}

// Like ppGet but without health reporting — for probes where a failure is an
// expected answer (PP 21 404s the uuid playlist route), not an outage.
async function rawGet(pp, path, signal) {
  const res = await fetch(`${baseUrl(pp)}${path}`, { signal: withTimeout(signal) });
  if (!res.ok) throw new Error(`ProPresenter ${res.status}`);
  return res.json();
}

// ── ProPresenter 21 compatibility ────────────────────────────────────────────
//
//  PP 21 (verified live against 21.1, 2026-07-24) broke two PP 7 behaviors
//  this module was built on:
//    · /v1/playlist/active answers all-null even while a presentation is live.
//    · /v1/playlist/{uuid} no longer resolves uuids — playlists are addressed
//      by index path ("/v1/playlist/1/0" = second root node, first child).
//  What still works: /v1/presentation/slide_index (the active presentation's
//  uuid), /v1/playlist/focused (a full playlist_item), and playlist bodies
//  whose items carry presentation_info.presentation_uuid. So when `active`
//  reads empty, we resolve the live item by its presentation uuid instead.

/** Fetch a playlist body by uuid (PP 7) or, failing that, index path (PP 21). */
async function fetchPlaylistBody(pp, ref, signal) {
  try {
    return await rawGet(pp, `/v1/playlist/${ref.uuid}`, signal);
  } catch {
    /* PP 21 — fall through to index-path addressing */
  }
  let path = ref.path;
  if (!path) {
    const all = flattenPlaylists(await ppGet(pp, '/v1/playlists', signal));
    path = all.find((p) => p.uuid === ref.uuid)?.path;
  }
  if (!path) throw new Error(`playlist ${ref.uuid} not found in /v1/playlists`);
  return ppGet(pp, `/v1/playlist/${path.join('/')}`, signal);
}

// Per-machine cache of the focused playlist's items for uuid resolution — the
// poller asks every ~800ms and the playlist rarely changes. `missed` remembers
// presentations that aren't in the playlist (launched from the library) so
// they don't refetch every poll; misses retry after REFETCH_MS in case the
// operator edited the playlist mid-show.
const REFETCH_MS = 60_000;
const resolveCache = new Map(); // healthKey → { playlistUuid, items, missed, fetchedAt }

async function resolveByPresentation(pp, slide, signal) {
  if (!slide?.presUuid) return null;
  const focused = await ppGet(pp, '/v1/playlist/focused', signal).catch(() => null);
  const playlistName = focused?.playlist?.name ?? null;
  // Common case: the live item is also the focused one (triggering selects).
  const direct = focused?.playlist_item;
  if (direct?.presentation_info?.presentation_uuid === slide.presUuid) {
    return itemShape(direct, playlistName);
  }
  // The focused SELECTION drifted from what's live (operator arrowing around)
  // — scan the focused playlist's items for the active presentation.
  const plUuid = focused?.playlist?.uuid;
  if (!plUuid) return null;
  const key = healthKey(pp);
  let c = resolveCache.get(key);
  const hitIn = (cache) =>
    cache?.items.find((it) => it.presentation_info?.presentation_uuid === slide.presUuid);
  const staleMiss = c && c.missed.has(slide.presUuid) && Date.now() - c.fetchedAt > REFETCH_MS;
  if (!c || c.playlistUuid !== plUuid || (!hitIn(c) && (staleMiss || !c.missed.has(slide.presUuid)))) {
    const body = await fetchPlaylistBody(pp, { uuid: plUuid }, signal).catch(() => null);
    if (body) {
      c = { playlistUuid: plUuid, items: body.items ?? [], missed: new Set(), fetchedAt: Date.now() };
      resolveCache.set(key, c);
    }
  }
  const hit = hitIn(c);
  if (!hit) {
    c?.missed.add(slide.presUuid);
    return null;
  }
  return itemShape(hit, playlistName);
}

/**
 * One-shot read of the current active playlist item. On PP 21 the `active`
 * route reads null mid-show, so we fall back to resolving by the active
 * presentation's uuid; pass a pre-fetched `slide` (from readSlide) to skip
 * the extra slide_index request.
 */
export async function readActive(pp, signal, slide) {
  const parsed = parseActive(await ppGet(pp, '/v1/playlist/active', signal));
  if (parsed.index != null) return parsed;
  const s = slide === undefined ? await readSlide(pp, signal).catch(() => null) : slide;
  return (await resolveByPresentation(pp, s, signal).catch(() => null)) ?? parsed;
}

/**
 * Pick the PP playlist that belongs to a PC plan. The PC push names playlists
 * "<series> - <plan title> - <dates>" (e.g. "… - July 12, 2026"), so the plan's
 * date string is the strong signal; the title breaks ties. Pure — tested.
 * `playlists` = flattened [{uuid, name}]. Returns the best match or null.
 */
export function pickPlaylistForPlan(playlists, plan) {
  let best = null;
  let bestScore = 0;
  for (const pl of playlists) {
    const name = norm(pl.name);
    let score = 0;
    if (plan?.dates && name.includes(norm(plan.dates))) score += 2;
    if (plan?.title && name.includes(norm(plan.title))) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = pl;
    }
  }
  return best;
}

// /v1/playlists nests folders via `children` — flatten to playlist leaves,
// keeping each leaf's index path (sibling positions) for PP 21 addressing.
function flattenPlaylists(nodes, out = [], prefix = []) {
  (nodes ?? []).forEach((n, i) => {
    const path = [...prefix, i];
    if (n.field_type === 'playlist' && n.id?.uuid) out.push({ uuid: n.id.uuid, name: n.id.name ?? '', path });
    flattenPlaylists(n.children, out, path);
  });
  return out;
}

/**
 * The items of the playlist to map a plan against (for the mapping-override
 * UI). Prefers the playlist that MATCHES the plan (by pushed name), so the
 * config screen shows the right service even while PP still has last week's
 * playlist open; falls back to the active playlist (matched: false → the UI
 * warns). Returns null when PP has neither. Shapes verified live:
 * /v1/playlist/{uuid} → { id, items: [{ id: {index,name,uuid}, type, … }] }.
 */
export async function readPlaylistItems(pp, signal, plan = null) {
  let target = null;
  let matched = false;
  if (plan) {
    const all = flattenPlaylists(await ppGet(pp, '/v1/playlists', signal).catch(() => []));
    const hit = pickPlaylistForPlan(all, plan);
    if (hit) {
      target = hit;
      matched = true;
    }
  }
  if (!target) {
    const active = await ppGet(pp, '/v1/playlist/active', signal);
    let pl = active?.presentation?.playlist ?? null;
    if (!pl?.uuid) {
      // PP 21 answers null here even mid-show — use the focused playlist.
      pl = (await ppGet(pp, '/v1/playlist/focused', signal).catch(() => null))?.playlist ?? null;
    }
    if (!pl?.uuid) return null;
    target = pl;
  }
  const body = await fetchPlaylistBody(pp, target, signal);
  return {
    playlistName: target.name ?? null,
    matched,
    items: (body.items ?? []).map((it) => ({
      index: it.id?.index ?? null,
      name: it.id?.name ?? '',
      type: it.type ?? 'presentation',
    })),
  };
}

/**
 * Cheapest real request — identifies the machine and app version, e.g.
 * "ProPresenter 21.1 · Booth-Mac". Reports into health like any read.
 */
export async function ping(pp, signal) {
  const v = await ppGet(pp, '/version', signal);
  return [v.host_description, v.name].filter(Boolean).join(' · ');
}

/** Current slide position within the active presentation. */
export async function readSlide(pp, signal) {
  const pi = (await ppGet(pp, '/v1/presentation/slide_index', signal)).presentation_index;
  return {
    slideIndex: pi?.index ?? null,
    presUuid: pi?.presentation_id?.uuid ?? null,
    presName: pi?.presentation_id?.name ?? null,
  };
}

/**
 * Total slide count of the active presentation for the given arrangement
 * (songs repeat groups, so different arrangements have different totals).
 * `arrangement` = { uuid, name } from the active playlist item. Falls back to
 * the presentation's own current_arrangement, then the raw group sum.
 */
export function slideTotal(pres, arrangement = null) {
  if (!pres) return null;
  const gcount = {};
  for (const g of pres.groups ?? []) gcount[g.uuid] = (g.slides ?? []).length;
  const arrs = pres.arrangements ?? [];

  let target = null;
  if (arrangement?.uuid) target = arrs.find((a) => a.id?.uuid === arrangement.uuid);
  if (!target && arrangement?.name) target = arrs.find((a) => a.id?.name === arrangement.name);
  if (!target && pres.current_arrangement) target = arrs.find((a) => a.id?.uuid === pres.current_arrangement);

  if (target && Array.isArray(target.groups)) {
    const t = target.groups.reduce((s, u) => s + (gcount[typeof u === 'string' ? u : u?.uuid] || 0), 0);
    if (t > 0) return t;
  }
  const raw = Object.values(gcount).reduce((a, b) => a + b, 0);
  return raw || null;
}

async function readSlideCount(pp, signal, arrangement) {
  return slideTotal((await ppGet(pp, '/v1/presentation/active', signal)).presentation, arrangement);
}

// ── Timers ────────────────────────────────────────────────────────────────────
//
//  The room's "Service Start Timer" pattern: one count-down-to-time timer, and
//  Message objects ("9:30AM", "11:00AM"…) whose timer token re-targets + starts
//  it when the operator clicks Show between services. We read the live value.

// A timer definition's count_down_to_time.time_of_day is a 12-HOUR value paired
// with an am/pm period (5:30 PM → 19800 + "pm"); normalize to absolute seconds
// since midnight. Verified against the live API.
export function targetSecondsOfDay(countDownToTime) {
  if (!countDownToTime || typeof countDownToTime.time_of_day !== 'number') return null;
  return (countDownToTime.time_of_day % 43200) + (countDownToTime.period === 'pm' ? 43200 : 0);
}

// "07:29:05" → seconds remaining.
export function parseHms(s) {
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(String(s ?? ''));
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** Merge /v1/timers (definitions) with /v1/timers/current (live values). */
export function parseTimers(defs, currents) {
  const byUuid = new Map((defs ?? []).map((d) => [d.id?.uuid, d]));
  return (currents ?? []).map((c) => {
    const def = byUuid.get(c.id?.uuid) ?? {};
    return {
      uuid: c.id?.uuid ?? null,
      name: c.id?.name ?? '',
      state: c.state ?? 'stopped',
      remainingSeconds: parseHms(c.time),
      targetSecondsOfDay: targetSecondsOfDay(def.count_down_to_time),
      countsDownToTime: Boolean(def.count_down_to_time),
    };
  });
}

/**
 * The room's service-start timer: the configured name if it matches, else the
 * first count-down-to-time timer, else the first timer.
 */
export function pickTimer(timers, preferredName = null) {
  if (!timers?.length) return null;
  if (preferredName) {
    const t = timers.find((x) => namesMatch(x.name, preferredName));
    if (t) return t;
  }
  return timers.find((t) => t.countsDownToTime) ?? timers[0];
}

/** One-shot read of all timers with live values. */
export async function readTimers(pp, signal) {
  const [defs, currents] = await Promise.all([
    ppGet(pp, '/v1/timers', signal),
    ppGet(pp, '/v1/timers/current', signal),
  ]);
  return parseTimers(defs, currents);
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    // Detach on normal completion — a 90-minute show polls thousands of times
    // on one signal and would otherwise leak a listener per poll.
    const onAbort = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Poll the active item + slide progress, calling onState(state) whenever any of
 * them changes, until the signal aborts. We poll (rather than stream) because
 * /v1/playlist/active's chunked response only sends the initial state. The
 * browser still gets real-time push, via our SSE.
 *
 * state = { itemIndex, itemName, slideIndex, slideCount, presName }
 */
export async function pollRunState(pp, onState, signal, intervalMs = 800) {
  let lastKey;
  let fails = 0;
  const countCache = { key: null, count: null };
  while (!signal.aborted) {
    try {
      const slide = await readSlide(pp, signal);
      const item = await readActive(pp, signal, slide); // slide feeds the PP 21 fallback
      fails = 0;
      // Slide count depends on the presentation AND the active arrangement;
      // refresh (expensive) only when either changes.
      const arrangement = { uuid: item.arrangementUuid, name: item.arrangementName };
      const cacheKey = slide.presUuid && `${slide.presUuid}|${arrangement.uuid || arrangement.name || ''}`;
      if (cacheKey && cacheKey !== countCache.key) {
        try {
          countCache.count = await readSlideCount(pp, signal, arrangement);
        } catch {
          countCache.count = null;
        }
        countCache.key = cacheKey;
      }
      const state = {
        itemIndex: item.index,
        itemName: item.name,
        slideIndex: slide.slideIndex,
        slideCount: cacheKey && cacheKey === countCache.key ? countCache.count : null,
        presName: slide.presName,
      };
      const key = JSON.stringify([state.itemIndex, state.slideIndex, state.slideCount]);
      if (key !== lastKey) {
        lastKey = key;
        onState(state);
      }
    } catch (err) {
      if (++fails >= 3) throw err; // sustained failure → SSE shows offline
    }
    await sleep(intervalMs, signal);
  }
}

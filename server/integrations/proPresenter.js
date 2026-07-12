// ─────────────────────────────────────────────────────────────────────────────
//  INTEGRATION: ProPresenter (official API, 7.9+)  —  live Run of Show tracking
//
//  The PC plan is pushed into ProPresenter as a playlist, so the active playlist
//  item maps 1:1 (by index) to our PC order of service. We stream the active
//  item via /v1/playlist/active?chunked=true and relay it to browsers over SSE.
//
//  Per-room host/port (ProPresenter picks an ephemeral API port). No auth (LAN).
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PORT = 62202;

export const isConfigured = (pp) => Boolean(pp?.host);

function baseUrl(pp) {
  return `http://${pp.host}:${pp.port ?? DEFAULT_PORT}`;
}

// ── Mapping (pure, tested) ────────────────────────────────────────────────────

// Extract the active presentation playlist item from a /v1/playlist/active body.
// Fields live under `playlist_item.id`; the active arrangement (which the
// presentation's own `current_arrangement` does NOT reliably report) lives under
// `playlist_item.presentation_info`. Both verified against the live API.
export function parseActive(state) {
  const p = state?.presentation ?? {};
  const pli = p.playlist_item ?? null;
  const id = pli?.id ?? null;
  const info = pli?.presentation_info ?? {};
  return {
    index: id?.index ?? null,
    name: id?.name ?? null,
    uuid: id?.uuid ?? null,
    arrangementUuid: info.arrangement_uuid || null,
    arrangementName: info.arrangement_name || null,
    playlistName: p.playlist?.name ?? null,
  };
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

async function ppGet(pp, path, signal) {
  const res = await fetch(`${baseUrl(pp)}${path}`, { signal: withTimeout(signal) });
  if (!res.ok) throw new Error(`ProPresenter ${res.status}`);
  return res.json();
}

/** One-shot read of the current active playlist item. */
export async function readActive(pp, signal) {
  return parseActive(await ppGet(pp, '/v1/playlist/active', signal));
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

// /v1/playlists nests folders via `children` — flatten to playlist leaves.
function flattenPlaylists(nodes, out = []) {
  for (const n of nodes ?? []) {
    if (n.field_type === 'playlist' && n.id?.uuid) out.push({ uuid: n.id.uuid, name: n.id.name ?? '' });
    flattenPlaylists(n.children, out);
  }
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
    const pl = active?.presentation?.playlist ?? null;
    if (!pl?.uuid) return null;
    target = pl;
  }
  const body = await ppGet(pp, `/v1/playlist/${target.uuid}`, signal);
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
      const [item, slide] = await Promise.all([readActive(pp, signal), readSlide(pp, signal)]);
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

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
// The item's fields live under `playlist_item.id` (verified against live API).
export function parseActive(state) {
  const p = state?.presentation ?? {};
  const id = p.playlist_item?.id ?? null;
  return {
    index: id?.index ?? null,
    name: id?.name ?? null,
    uuid: id?.uuid ?? null,
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
 * Total slide count of the active presentation. Uses the current arrangement's
 * expanded sequence (songs repeat groups); falls back to the raw group sum when
 * no arrangement is selected.
 */
export function slideTotal(pres) {
  if (!pres) return null;
  const gcount = {};
  for (const g of pres.groups ?? []) gcount[g.uuid] = (g.slides ?? []).length;
  const cur = pres.current_arrangement;
  if (cur) {
    const arr = (pres.arrangements ?? []).find((a) => a.id?.uuid === cur);
    if (arr && Array.isArray(arr.groups)) {
      const t = arr.groups.reduce((s, u) => s + (gcount[typeof u === 'string' ? u : u?.uuid] || 0), 0);
      if (t > 0) return t;
    }
  }
  const raw = Object.values(gcount).reduce((a, b) => a + b, 0);
  return raw || null;
}

async function readSlideCount(pp, signal) {
  return slideTotal((await ppGet(pp, '/v1/presentation/active', signal)).presentation);
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
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
  const countCache = { uuid: null, count: null };
  while (!signal.aborted) {
    try {
      const [item, slide] = await Promise.all([readActive(pp, signal), readSlide(pp, signal)]);
      fails = 0;
      // Refresh the (expensive) slide count only when the presentation changes.
      if (slide.presUuid && slide.presUuid !== countCache.uuid) {
        try {
          countCache.count = await readSlideCount(pp, signal);
        } catch {
          countCache.count = null;
        }
        countCache.uuid = slide.presUuid;
      }
      const state = {
        itemIndex: item.index,
        itemName: item.name,
        slideIndex: slide.slideIndex,
        slideCount: slide.presUuid === countCache.uuid ? countCache.count : null,
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

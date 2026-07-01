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

/** One-shot read of the current active item. */
export async function readActive(pp, signal) {
  const timeout = AbortSignal.timeout(3000);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const res = await fetch(`${baseUrl(pp)}/v1/playlist/active`, { signal: sig });
  if (!res.ok) throw new Error(`ProPresenter ${res.status}`);
  return parseActive(await res.json());
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/**
 * Poll the active item and call onState(active) whenever it CHANGES, until the
 * signal aborts. We poll (rather than stream) because /v1/playlist/active's
 * chunked response only sends the initial state — it does not push item changes.
 * The browser still gets real-time push, via our SSE.
 */
export async function pollActive(pp, onState, signal, intervalMs = 1000) {
  let lastKey;
  let fails = 0;
  while (!signal.aborted) {
    try {
      const active = await readActive(pp, signal);
      fails = 0;
      const key = active.index == null ? 'none' : `${active.index}:${active.name ?? ''}`;
      if (key !== lastKey) {
        lastKey = key;
        onState(active);
      }
    } catch (err) {
      if (++fails >= 3) throw err; // give up after sustained failure → SSE shows offline
    }
    await sleep(intervalMs, signal);
  }
}

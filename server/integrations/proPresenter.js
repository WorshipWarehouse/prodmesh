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
export async function readActive(pp) {
  const res = await fetch(`${baseUrl(pp)}/v1/playlist/active`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`ProPresenter ${res.status}`);
  return parseActive(await res.json());
}

// Pull complete JSON objects out of a growing buffer (chunked stream framing).
function takeJson(buf) {
  const start = buf.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < buf.length; i++) {
    const c = buf[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      return { json: buf.slice(start, i + 1), rest: buf.slice(i + 1) };
    }
  }
  return null;
}

/**
 * Subscribe to active-item changes. Calls onState(active) for each update until
 * the signal aborts or the connection ends.
 */
export async function subscribeActive(pp, onState, signal) {
  const res = await fetch(`${baseUrl(pp)}/v1/playlist/active?chunked=true`, { signal });
  if (!res.ok || !res.body) throw new Error(`ProPresenter ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let out;
    while ((out = takeJson(buf))) {
      buf = out.rest;
      try {
        onState(parseActive(JSON.parse(out.json)));
      } catch {
        /* skip malformed frame */
      }
    }
  }
}

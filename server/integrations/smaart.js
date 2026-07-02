// ─────────────────────────────────────────────────────────────────────────────
//  INTEGRATION: Rational Acoustics Smaart  —  room loudness (SPL).
//
//  Smaart v9 products (Suite/RT/LE/SPL) expose a JSON-over-WebSocket API at
//  ws://<host>:<port>/api/v4/  (default port 26000; enable in Smaart under
//  Options → Preferences → API). Envelope grammar, verified from Bitfocus's
//  open-source Companion modules:
//
//    → { sequenceNumber, action: 'get'|'set'|'issueCommand', target?, properties? }
//    ← { sequenceNumber, response: {...} }
//
//  A bare {action:'get'} on connect returns global state including
//  `authenticationRequired`; if true, authenticate with
//  {action:'set', properties:[{ password }]}.
//
//  MOCK-FIRST: the exact meter-read command is only in Rational's SDK doc
//  (free on request) — the Companion modules never read values. Until we
//  verify against a live Smaart at church, rooms use `mock: true` and get a
//  realistic wandering meter; the pipeline (capture → SQLite → report) is
//  identical either way.
//
//  config = { mock?: true, host?, port?, password?, target?, limit? }
//    target/limit: dB goals per room (e.g. Sundays target 90, not to exceed 95).
// ─────────────────────────────────────────────────────────────────────────────

export const isConfigured = (cfg) => Boolean(cfg && (cfg.mock || cfg.host));

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/**
 * Emit ~1 sample/second: onSample({ ts, spl }) until the signal aborts.
 * Mock: a bounded random walk that feels like a worship set (quiet floor,
 * builds, occasional pushes toward the limit).
 */
export async function watchSpl(cfg, onSample, signal, intervalMs = 1000) {
  if (cfg?.mock) return mockLoop(cfg, onSample, signal, intervalMs);
  return realLoop(cfg, onSample, signal, intervalMs);
}

async function mockLoop(cfg, onSample, signal, intervalMs) {
  let spl = 84;
  while (!signal.aborted) {
    // Random walk with a pull back toward 86 so it hovers realistically.
    spl += (Math.random() - 0.5) * 2.4 + (86 - spl) * 0.02;
    if (Math.random() < 0.03) spl += 4 + Math.random() * 4; // chorus hits
    spl = Math.min(98, Math.max(76, spl));
    onSample({ ts: Date.now(), spl: Math.round(spl * 10) / 10 });
    await sleep(intervalMs, signal);
  }
}

// Real transport: connect/auth per the grammar above, then subscribe to the
// SPL meter. The read command needs verification against a live Smaart or the
// SDK doc — fail loudly rather than guess at message shapes.
async function realLoop(cfg) {
  throw new Error(
    `Smaart live transport not implemented yet (host ${cfg?.host}). ` +
      'Needs the SDK meter-read command verified on-site — use mock: true until then.',
  );
}

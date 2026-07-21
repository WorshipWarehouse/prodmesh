// ─────────────────────────────────────────────────────────────────────────────
//  INTEGRATION: ProdMesh Remote RTA  —  room loudness (SPL).
//
//  The free companion analyzer (github.com/jbeale/prodmesh-rta). Enable its
//  API under Settings → API & Streaming (default port 8517) and it pushes a
//  JSON snapshot over a plain WebSocket:
//
//   Stream  ws://<host>:<port>/api/stream
//    ← { type: 'levels', time_ms, weighting, fast_db, slow_db, leq_db,
//        bands_db: [...], metrics: { laf, las, leq, leqS, leqL, ... }, alarm }
//    Pushed at the app's configured stream rate (1–20 Hz); the current
//    snapshot arrives immediately on connect. Levels are null until the
//    input has audio. Read-only — the client never sends anything.
//
//  config = { host, port?, metric?, target?, limit? }
//    metric: a metric id from the `metrics` map (e.g. 'las', 'leqS').
//            Default slow_db — same meaning as Smaart's "SPL A Slow" when the
//            app is A-weighted, so reports stay comparable across sources.
//    target/limit: dB goals per room, same semantics as the Smaart config.
//
//  Like the Smaart watcher: retries forever with backoff (app closed between
//  services, machine asleep) and resolves only when aborted.
// ─────────────────────────────────────────────────────────────────────────────
import WebSocket from 'ws';

export const isConfigured = (cfg) => Boolean(cfg && cfg.host);

const RETRY_MS = 5000;
const CONNECT_TIMEOUT_MS = 8000;
const STALE_STREAM_MS = 15000; // no frames for this long → reconnect

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const onAbort = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Emit ≤1 sample/interval: onSample({ ts, spl }) until the signal aborts. */
export async function watchSpl(cfg, onSample, signal, intervalMs = 1000) {
  let warned = false;
  const state = { announced: false };
  while (!signal.aborted) {
    try {
      await streamOnce(cfg, onSample, signal, intervalMs, state);
      warned = false;
    } catch (err) {
      if (!signal.aborted && !warned) {
        console.error(`[rta] ${cfg.host}:${cfg.port ?? 8517}: ${err.message} — retrying`);
        warned = true; // one line per outage, not one per retry
      }
      state.announced = false;
    }
    await sleep(RETRY_MS, signal);
  }
}

function streamOnce(cfg, onSample, signal, intervalMs, state) {
  const url = `ws://${cfg.host}:${cfg.port ?? 8517}/api/stream`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { handshakeTimeout: CONNECT_TIMEOUT_MS });
    let stale = null;
    let lastEmit = 0;
    const bump = () => {
      clearTimeout(stale);
      stale = setTimeout(() => finish(new Error('stream went quiet')), STALE_STREAM_MS);
    };
    const finish = (err) => {
      clearTimeout(stale);
      signal.removeEventListener('abort', onAbort);
      ws.close();
      err ? reject(err) : resolve();
    };
    const onAbort = () => finish();
    signal.addEventListener('abort', onAbort, { once: true });
    ws.on('error', (err) => finish(err));
    ws.on('close', () => finish(new Error('stream closed')));
    ws.on('open', bump);
    ws.on('message', (data) => {
      bump();
      const spl = metricFrom(data, cfg, state);
      // The app pushes at its own rate (up to 20 Hz); keep our sampling rate.
      // The quarter-interval slack keeps a stream paced near intervalMs from
      // skipping every other frame over timing jitter.
      if (spl != null && Date.now() - lastEmit >= intervalMs * 0.75) {
        lastEmit = Date.now();
        onSample({ ts: Date.now(), spl: Math.round(spl * 10) / 10 });
      }
    });
  });
}

// Pull the configured metric out of a levels frame. Levels are null until the
// analyzer's input has audio — those frames keep the stream alive but yield
// no sample (the meter simply stays dark, like Smaart before logging starts).
function metricFrom(data, cfg, state) {
  let frame;
  try {
    frame = JSON.parse(data);
  } catch {
    return null;
  }
  if (frame?.type !== 'levels') return null;
  if (!state.announced) {
    console.log(`[rta] ${cfg.host}: ProdMesh Remote RTA (${frame.weighting ?? '?'}-weighted)`);
    state.announced = true;
  }
  const v = cfg.metric ? frame.metrics?.[cfg.metric] : frame.slow_db;
  return typeof v === 'number' ? v : null;
}

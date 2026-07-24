// ─────────────────────────────────────────────────────────────────────────────
//  INTEGRATION: Rational Acoustics Smaart  —  room loudness (SPL).
//
//  Smaart v9 products (Suite/RT/LE/SPL) expose a JSON-over-WebSocket API
//  (enable in Smaart under Options → API; default port 26000). Protocol per
//  Rational's Smaart API v4 SDK doc (30 July 2025):
//
//   RPC socket  ws://<host>:<port>/api/v4/
//    → { sequenceNumber, action: 'get'|'set', target?, properties? }
//    ← { sequenceNumber, response: {...} }            (response.error on failure)
//    A bare {action:'get'} returns server info incl. `authenticationRequired`;
//    if true, authenticate with {action:'set', properties:[{ password }]}.
//    {action:'get', target:'activeCalibratedInputs'} lists logging inputs:
//    devices[] → activeCalibratedChannels[] → { channelName, streamEndpoint }.
//
//   Metric stream  ws://<host>:<port><streamEndpoint>
//    Pushes { timestamp, deviceName, channelName, metrics:[{ "<name>": dB }] }
//    at 8 fps; throttle with {action:'set', properties:[{ targetFPS: 1 }]}
//    (stream commands get no response). Metric names include "SPL A Slow",
//    "SPL Slow", "LAeq 10", etc. — whatever the input's meter config exposes.
//
//  API versions: Smaart v9-era products serve API v4 at /api/v4/. Smaart v8
//  (verified live on 8.5.2.2) serves the same dialect at /api/v3/ — its v4
//  path accepts the WebSocket but never answers RPCs. We try v4 then v3 and
//  cache whichever answered; set cfg.apiPath to pin one explicitly.
//
//  config = { mock?: true, host?, port?, password?, device?, channel?,
//             metric?, target?, limit?, apiPath? }
//    device/channel: pick a specific logging input (default: first active one).
//    metric: which meter to record (default "SPL A Slow" — A-weighted slow is
//            the venue-loudness standard).
//    target/limit: dB goals per room (e.g. Sundays target 90, not to exceed 95).
//
//  The watcher retries forever with backoff (Smaart restarts between services,
//  logging starts late, FOH Mac reboots) and resolves only when aborted.
// ─────────────────────────────────────────────────────────────────────────────
import WebSocket from 'ws';
import { report } from '../health.js';

export const isConfigured = (cfg) => Boolean(cfg && (cfg.mock || cfg.host));

// Health key shared with rta.js — both are the room's "analysis" source.
export const healthKey = (cfg) => `analysis@${cfg.host}:${cfg.port ?? 26000}`;

const RETRY_MS = 5000;
const RPC_TIMEOUT_MS = 8000;
const HELLO_TIMEOUT_MS = 3000; // per-path liveness check while finding the API
const STALE_STREAM_MS = 15000; // no frames for this long → reconnect
const API_PATHS = ['/api/v4/', '/api/v3/'];

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    // Detach on normal completion so long-lived signals don't leak listeners.
    const onAbort = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
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

// ── Real transport ───────────────────────────────────────────────────────────

async function realLoop(cfg, onSample, signal, intervalMs) {
  let warned = false;
  const state = { path: null, announced: null }; // API path cache across reconnects
  while (!signal.aborted) {
    try {
      await streamOnce(cfg, onSample, signal, intervalMs, state);
      warned = false; // stream worked at some point; re-warn if it breaks again
    } catch (err) {
      if (!signal.aborted) {
        report(healthKey(cfg), false, err.message);
        if (!warned) {
          console.error(`[smaart] ${cfg.host}:${cfg.port ?? 26000}: ${err.message} — retrying`);
          warned = true; // one line per outage, not one per retry
        }
      }
    }
    await sleep(RETRY_MS, signal);
  }
}

// One full connect → discover input → stream cycle. Throws on any failure;
// returns when the stream closes (realLoop reconnects) or the signal aborts.
async function streamOnce(cfg, onSample, signal, intervalMs, state) {
  const base = `ws://${cfg.host}:${cfg.port ?? 26000}`;
  const { rpc, call, info } = await connectRpc(base, cfg, state, signal);
  let endpoint;
  try {
    if (info.authenticationRequired) {
      if (!cfg.password) throw new Error('Smaart API requires a password (set smaart.password)');
      await call({ action: 'set', properties: [{ password: cfg.password }] });
    }
    report(healthKey(cfg), true); // connected + answering RPCs (auth done)
    if (state.announced !== state.path) {
      console.log(
        `[smaart] ${cfg.host}: ${info.applicationName ?? 'Smaart'} ${info.applicationVersion ?? ''} via ${state.path}`.replace(/\s+/g, ' '),
      );
      state.announced = state.path;
    }
    const inputs = await call({ action: 'get', target: 'activeCalibratedInputs' });
    endpoint = pickChannel(inputs, cfg).streamEndpoint;
  } finally {
    rpc.close();
  }

  const stream = await openSocket(base + endpoint, signal);
  try {
    // Streams start at 8 fps; ask for our sampling rate (no response is sent).
    const fps = Math.max(1, Math.min(8, Math.round(1000 / intervalMs)));
    stream.send(JSON.stringify({ action: 'set', properties: [{ targetFPS: fps }] }));
    await readFrames(stream, cfg, onSample, signal);
  } finally {
    stream.close();
  }
}

// Resolves when the stream closes or the signal aborts; kills stale sockets
// that stop sending frames without closing (sleeping FOH Mac, dead network).
function readFrames(stream, cfg, onSample, signal) {
  return new Promise((resolve, reject) => {
    let stale = null;
    const bump = () => {
      clearTimeout(stale);
      stale = setTimeout(() => reject(new Error('stream went quiet')), STALE_STREAM_MS);
    };
    bump();
    const done = (fn) => (arg) => { clearTimeout(stale); fn(arg); };
    signal.addEventListener('abort', done(resolve), { once: true });
    stream.on('close', done(() => reject(new Error('stream closed'))));
    stream.on('error', done(reject));
    stream.on('message', (data) => {
      bump();
      const spl = metricFrom(data, cfg);
      if (spl != null) onSample({ ts: Date.now(), spl: Math.round(spl * 10) / 10 });
    });
  });
}

// Pull the configured metric out of a stream frame. Smaart sends
// metrics: [{ "SPL A Slow": 74.8 }, ...] — one single-key object per meter
// (plus an occasional `violation: true` alongside the value).
function metricFrom(data, cfg) {
  let frame;
  try {
    frame = JSON.parse(data);
  } catch {
    return null;
  }
  if (!Array.isArray(frame?.metrics)) return null;
  const want = cfg.metric ?? 'SPL A Slow';
  let fallback = null;
  for (const m of frame.metrics) {
    if (typeof m?.[want] === 'number') return m[want];
    if (fallback == null) {
      // Only fall back to actual loudness meters (SPL/Leq families) — frames
      // also carry dBFS meters like "FS Peak" that would poison show reports.
      const [name, v] = Object.entries(m ?? {}).find(
        ([k, x]) => typeof x === 'number' && /SPL|eq/i.test(k),
      ) ?? [];
      if (name) fallback = v;
    }
  }
  return fallback;
}

// Choose a logging input from the activeCalibratedInputs response.
function pickChannel(inputs, cfg) {
  const channels = (inputs?.devices ?? []).flatMap((d) =>
    (d.activeCalibratedChannels ?? []).map((c) => ({ ...c, deviceName: d.deviceName })),
  );
  const match = channels.find(
    (c) =>
      (!cfg.device || c.deviceName === cfg.device) &&
      (!cfg.channel || c.channelName === cfg.channel),
  );
  if (!match?.streamEndpoint) {
    const have = channels.map((c) => `${c.deviceName}/${c.channelName}`).join(', ') || 'none';
    throw new Error(
      `no matching calibrated input (want ${cfg.device ?? 'any'}/${cfg.channel ?? 'any'}; ` +
        `active: ${have}) — is Smaart logging?`,
    );
  }
  return match;
}

// ── SPL logging control ──────────────────────────────────────────────────────
//  The API has no logging start/stop target, but the command handler can
//  invoke any UI command by its bound keypress ("Toggle SPL Logging", verified
//  live on Suite 9.6.4). The keypress is looked up by description — bindings
//  differ across versions/platforms. Because the command is a toggle, we read
//  the actual state first (activeCalibratedInputs non-empty = logging) and
//  only fire when it differs, then poll to confirm the flip took.

const hasLoggingInputs = (inputs) =>
  (inputs?.devices ?? []).some((d) => (d.activeCalibratedChannels ?? []).length > 0);

/**
 * Ensure Smaart's SPL logging is on/off. Returns { changed, logging }.
 * Throws if Smaart is unreachable, exposes no toggle command, or the state
 * doesn't flip (e.g. turning on with no calibrated input configured).
 */
export async function setLogging(cfg, on, signal = new AbortController().signal) {
  const base = `ws://${cfg.host}:${cfg.port ?? 26000}`;
  const state = { path: cfg.apiPath ?? null };
  const { rpc, call, info } = await connectRpc(base, cfg, state, signal);
  try {
    if (info.authenticationRequired) {
      if (!cfg.password) throw new Error('Smaart API requires a password (set analysis.password)');
      await call({ action: 'set', properties: [{ password: cfg.password }] });
    }
    const logging = async () =>
      hasLoggingInputs(await call({ action: 'get', target: 'activeCalibratedInputs' }));
    if ((await logging()) === on) return { changed: false, logging: on };
    const { commands = [] } = await call({ action: 'get', target: 'commands' });
    const keypress = commands
      .find((c) => /toggle spl logging/i.test(c.description ?? ''))
      ?.keypresses?.find(Boolean);
    if (!keypress) throw new Error('Smaart exposes no "Toggle SPL Logging" command');
    await call({ action: 'issueCommand', properties: [{ keypress }] });
    // The toggle lands on Smaart's UI thread — poll briefly for the flip.
    for (let i = 0; i < 5; i++) {
      await sleep(400, signal);
      if ((await logging()) === on) return { changed: true, logging: on };
    }
    throw new Error(
      `SPL logging did not turn ${on ? 'on' : 'off'}` + (on ? ' (no calibrated input in Smaart?)' : ''),
    );
  } finally {
    rpc.close();
  }
}

// Connect to whichever API path this Smaart answers on. The bare `get`
// doubles as the liveness hello: a silent path (v8's /api/v4/) times out
// quickly and we move on. The answering path is cached; if it later goes
// quiet (Smaart upgraded?) the cache clears and the next cycle re-probes.
async function connectRpc(base, cfg, state, signal) {
  const paths = cfg.apiPath
    ? [cfg.apiPath]
    : state.path
      ? [state.path, ...API_PATHS.filter((p) => p !== state.path)]
      : API_PATHS;
  let lastErr;
  for (const path of paths) {
    if (signal.aborted) break;
    let rpc;
    try {
      rpc = await openSocket(base + path, signal);
      const call = makeRpc(rpc, signal);
      const info = await call({ action: 'get' }, cfg.helloMs ?? HELLO_TIMEOUT_MS);
      state.path = path;
      return { rpc, call, info };
    } catch (err) {
      rpc?.close();
      lastErr = err;
      if (state.path === path) state.path = null;
    }
  }
  throw new Error(`no answering Smaart API (tried ${paths.join(', ')}): ${lastErr?.message ?? 'aborted'}`);
}

// ── WebSocket plumbing ───────────────────────────────────────────────────────

function openSocket(url, signal) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { handshakeTimeout: RPC_TIMEOUT_MS });
    const onAbort = () => ws.close();
    signal.addEventListener('abort', onAbort, { once: true });
    ws.once('open', () => resolve(ws));
    ws.once('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });
    ws.once('close', () => signal.removeEventListener('abort', onAbort));
  });
}

// Request/response over the RPC socket, correlated by sequenceNumber
// (the server echoes it back when non-zero).
function makeRpc(ws, signal) {
  let seq = 0;
  return (req, timeoutMs = RPC_TIMEOUT_MS) =>
    new Promise((resolve, reject) => {
      const sequenceNumber = ++seq;
      const timer = setTimeout(() => finish(new Error('Smaart RPC timeout')), timeoutMs);
      const finish = (err, val) => {
        clearTimeout(timer);
        ws.off('message', onMsg);
        ws.off('close', onClose);
        signal.removeEventListener('abort', onClose);
        err ? reject(err) : resolve(val);
      };
      const onClose = () => finish(new Error('Smaart RPC socket closed'));
      const onMsg = (data) => {
        let msg;
        try {
          msg = JSON.parse(data);
        } catch {
          return;
        }
        if (msg.sequenceNumber !== sequenceNumber) return; // someone else's reply
        if (msg.response?.error) return finish(new Error(`Smaart: ${msg.response.error}`));
        finish(null, msg.response ?? {});
      };
      ws.on('message', onMsg);
      ws.once('close', onClose);
      signal.addEventListener('abort', onClose, { once: true });
      ws.send(JSON.stringify({ sequenceNumber, ...req }));
    });
}

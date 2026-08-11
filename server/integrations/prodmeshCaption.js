// ProdMesh Caption — ws://host:8518/api/stream
//
// Fully specified in that project's docs/api.md, and the spec is unusually
// precise about the two things a client actually gets wrong:
//
//   · A `final` SUPERSEDES every `partial` with the same (ch, utt). So the
//     utterance key is (ch, utt) and a settled line replaces the live one in
//     place — never appends. `rev` rises within an utterance so a coalesced or
//     out-of-order partial can be dropped.
//   · `tick` arrives every 5 s and is HALF THE HEALTH CHECK. A crashed app
//     looks exactly like a quiet room; a stale tick does not.
//
// The API is read-only by design, so there is nothing here that could disturb
// a service even by accident.

import WebSocket from 'ws';
import { report } from '../health.js';

export const DEFAULT_PORT = 8518;

/** Treat this long without a `tick` as a fault — the app's own doc says 12 s. */
export const STALE_MS = 12_000;

const url = (cfg) => `ws://${cfg.host}:${Number(cfg.port) || DEFAULT_PORT}/api/stream`;

/**
 * One server frame → what the watcher should do about it. Pure, because this
 * is the half that can be tested against the documented payloads.
 */
export function parseFrame(msg) {
  switch (msg?.type) {
    case 'channels':
      return {
        kind: 'channels',
        // The roster calls it `id`; lines call the same number `ch`.
        channels: (msg.channels ?? []).map((c) => ({
          ch: String(c.id),
          name: c.name || `Channel ${c.id}`,
          color: c.color || null,
        })),
      };
    case 'partial':
    case 'final': {
      if (typeof msg.text !== 'string' || !msg.text) return { kind: 'ignore' };
      return {
        kind: 'line',
        line: {
          // (ch, utt) is the utterance, which is what makes a final replace its
          // partials rather than pile up under them.
          id: `${msg.ch}:${msg.utt}`,
          ch: String(msg.ch),
          text: msg.text,
          live: msg.type === 'partial',
          at: Number(msg.wall_ms) || Date.now(),
          rev: Number(msg.rev) || 0,
        },
      };
    }
    case 'tick':
      return { kind: 'tick' };
    default:
      // welcome, speech, state, error, replay_* — nothing the transcript needs.
      return { kind: 'ignore' };
  }
}

export async function watch(cfg, handlers, signal) {
  const key = `captions@${cfg.host}:${Number(cfg.port) || DEFAULT_PORT}`;
  await new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocket(url(cfg), { handshakeTimeout: 5000 });
    } catch (err) {
      report(key, false, String(err?.message ?? err));
      return resolve();
    }

    let lastTick = Date.now();
    // `close` fires after an explicit close, so done() is reached twice on
    // every teardown. Without this the health registry counts one dropped
    // connection as two consecutive failures.
    let settled = false;
    const done = (why) => {
      if (settled) return;
      settled = true;
      clearInterval(stale);
      signal.removeEventListener('abort', onAbort);
      handlers.onUp?.(false);
      if (why) report(key, false, why);
      try { ws.close(); } catch { /* already closing */ }
      resolve();
    };
    const onAbort = () => done(null); // a viewer left; not a fault
    signal.addEventListener('abort', onAbort, { once: true });

    // The other half of the health check: a socket that is open but silent.
    const stale = setInterval(() => {
      if (Date.now() - lastTick > STALE_MS) done('no tick — caption app not responding');
    }, 2000);
    stale.unref?.();

    ws.on('open', () => {
      lastTick = Date.now();
      report(key, true);
      handlers.onUp?.(true);
      // NO `events` key, deliberately — see INTEGRATION-NOTES. Sending one at
      // all silences `tick`, and `tick` is half the health check: without it a
      // crashed app is indistinguishable from a quiet room, which is the exact
      // failure the caption app's own docs warn about. Measured 2026-08-11:
      // default subscribe → a tick every 5 s; `events:['partial','final']` →
      // none in 14 s; even `events:[…,'tick']` → none. The default set is
      // already partial + final + state, which is what we want anyway.
      ws.send(JSON.stringify({ type: 'subscribe', channels: 'all' }));
    });
    ws.on('message', (raw) => {
      lastTick = Date.now();
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      const out = parseFrame(msg);
      if (out.kind === 'channels') handlers.onChannels?.(out.channels);
      else if (out.kind === 'line') handlers.onLine?.(out.line);
    });
    ws.on('error', (err) => done(String(err?.message ?? err)));
    ws.on('close', () => done(signal.aborted ? null : 'connection closed'));
  });
}

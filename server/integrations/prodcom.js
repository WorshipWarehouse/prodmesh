// ProdCom — ws://host:24480/api/v1/ws
//
// ⚠️ WRITTEN FROM THE PUBLISHED SPEC, NOT FROM A LIVE INSTANCE. See
// docs/INTEGRATION-NOTES.md for exactly which parts are specified and which
// are inferred; this file's job is to be honest about the difference.
//
// What the spec DOES pin down (prodcom.io/docs/openapi.yaml, 0.1.0):
//   · the path and that it is a WebSocket upgrade
//   · `{"type":"subscribe","events":["transcript"]}` filters the stream
//   · a `{"type":"welcome"}` frame arrives immediately after upgrade
//   · `{"type":"heartbeat"}` frames arrive periodically and must be ECHOED
//     BACK or the connection is dropped — the one behaviour here with no
//     counterpart in the other source, and a silent killer if missed
//   · PSK auth via `Authorization: Bearer <key>` or `?key=`
//   · the TranscriptEntry schema: id, channelId, channelName, text, source,
//     inProgress, hasBeenSeen, date, completeDate, translatedText
//
// What it does NOT: the ENVELOPE around a transcript event. The prose says
// only "Each event is a JSON object representing a new, updated, or completed
// transcript entry". So `parseFrame` identifies an entry BY ITS SHAPE and
// accepts it bare or wrapped — which costs a few lines and removes the whole
// class of "guessed the wrapper wrong" failure.

import WebSocket from 'ws';
import { report } from '../health.js';

export const DEFAULT_PORT = 24480;

const url = (cfg) => {
  const base = `ws://${cfg.host}:${Number(cfg.port) || DEFAULT_PORT}/api/v1/ws`;
  // The key also goes in the header below; the query form is the documented
  // alternative and costs nothing to send as well.
  return cfg.key ? `${base}?key=${encodeURIComponent(cfg.key)}` : base;
};

/** Does this object look like a TranscriptEntry? Shape, not position. */
const isEntry = (o) =>
  Boolean(o) && typeof o === 'object' &&
  typeof o.text === 'string' &&
  typeof o.channelId === 'string' &&
  'inProgress' in o;

/** Pull an entry out of whatever the frame wraps it in. */
function entryOf(msg) {
  if (isEntry(msg)) return msg;
  for (const k of ['data', 'entry', 'transcript', 'payload']) {
    if (isEntry(msg?.[k])) return msg[k];
  }
  return null;
}

/**
 * One server frame → what the watcher should do about it. Pure, and the only
 * part of this module that can be tested without ProdCom running.
 */
export function parseFrame(msg) {
  if (msg?.type === 'heartbeat') return { kind: 'heartbeat' };

  const entry = entryOf(msg);
  if (entry) {
    if (!entry.text) return { kind: 'ignore' };
    const at = Date.parse(entry.completeDate ?? entry.date ?? '');
    return {
      kind: 'line',
      line: {
        // The entry's own id survives the partial → complete transition, so a
        // settled line replaces the live one rather than appending beside it.
        id: String(entry.id ?? `${entry.channelId}:${entry.date}`),
        ch: String(entry.channelId),
        // channelName is denormalised onto the entry, so a transcript is
        // readable even before the channel roster arrives.
        name: entry.channelName || null,
        text: entry.text,
        live: entry.inProgress === true,
        at: Number.isFinite(at) ? at : Date.now(),
        rev: 0,
      },
    };
  }

  // Channel rosters are documented as a REST resource; whether the socket also
  // pushes them is not specified, so this accepts one if it appears and does
  // not depend on it.
  const list = Array.isArray(msg?.channels) ? msg.channels : null;
  if (list) {
    return {
      kind: 'channels',
      channels: list
        .filter((c) => c && c.id != null)
        .map((c) => ({ ch: String(c.id), name: c.name || 'Channel', color: c.color || null })),
    };
  }

  return { kind: 'ignore' };
}

export async function watch(cfg, handlers, signal) {
  const key = `captions@${cfg.host}:${Number(cfg.port) || DEFAULT_PORT}`;
  await new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocket(url(cfg), {
        handshakeTimeout: 5000,
        headers: cfg.key ? { Authorization: `Bearer ${cfg.key}` } : undefined,
      });
    } catch (err) {
      report(key, false, String(err?.message ?? err));
      return resolve();
    }

    // `close` fires after an explicit close, so done() is reached twice on
    // every teardown. Without this the health registry counts one dropped
    // connection as two consecutive failures.
    let settled = false;
    const done = (why) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      handlers.onUp?.(false);
      if (why) report(key, false, why);
      try { ws.close(); } catch { /* already closing */ }
      resolve();
    };
    const onAbort = () => done(null);
    signal.addEventListener('abort', onAbort, { once: true });

    ws.on('open', () => {
      report(key, true);
      handlers.onUp?.(true);
      ws.send(JSON.stringify({ type: 'subscribe', events: ['transcript', 'channel'] }));
    });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      const out = parseFrame(msg);
      // Echoing is not politeness — the spec says the connection is dropped
      // without it, so a passive client dies after one interval.
      if (out.kind === 'heartbeat') {
        try { ws.send(JSON.stringify({ type: 'heartbeat' })); } catch { /* closing */ }
      } else if (out.kind === 'channels') handlers.onChannels?.(out.channels);
      else if (out.kind === 'line') handlers.onLine?.(out.line);
    });
    ws.on('error', (err) => done(String(err?.message ?? err)));
    ws.on('close', () => done(signal.aborted ? null : 'connection closed'));
  });
}

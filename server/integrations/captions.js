// ─────────────────────────────────────────────────────────────────────────────
//  CAPTIONS  —  live speech-to-text from a production comms app.
//
//  What it is for: the music director and monitor engineer talk to the band on
//  a private comms channel, and the players on stage READ it. In-ear monitors
//  and a loud stage make that the only way the message arrives.
//
//  Two interchangeable sources, dispatched here exactly the way analysis.js
//  dispatches Smaart and Remote RTA:
//
//    prodmesh-caption   ws://host:8518/api/stream       (docs/api.md in that repo)
//    prodcom            ws://host:24480/api/v1/ws       (prodcom.io/docs/api)
//
//  They disagree about almost everything — integer channel vs UUID, two message
//  types vs one boolean, a heartbeat you ignore vs one you must echo — so each
//  source normalises onto the CaptionLine below and nothing above this layer
//  knows which app is running.
//
//  READ-ONLY, deliberately. ProdCom's API can create channels, reorder them and
//  clear transcripts; prodmesh never calls any of it. The caption app's own
//  documentation gives the reason better than we could: "a caption encoder must
//  not be able to disrupt a service."
// ─────────────────────────────────────────────────────────────────────────────

import * as prodmeshCaption from './prodmeshCaption.js';
import * as prodcom from './prodcom.js';

/**
 * @typedef {object} CaptionLine
 * @property {string} id     Stable for one utterance, so a partial can be
 *                           replaced in place rather than appended.
 * @property {string} ch     Channel identity as a string — an index on one
 *                           source, a UUID on the other.
 * @property {string} text
 * @property {boolean} live  Still being spoken. A settled line never changes.
 * @property {number} at     Epoch ms.
 */

const SOURCES = {
  'prodmesh-caption': prodmeshCaption,
  prodcom,
};

export const sourceNames = Object.keys(SOURCES);

/** Configured = we know which app and where. */
export const isConfigured = (cfg) => Boolean(cfg && SOURCES[cfg.source] && cfg.host);

const impl = (cfg) => SOURCES[cfg?.source] ?? null;

export const defaultPort = (source) => SOURCES[source]?.DEFAULT_PORT ?? null;

export const port = (cfg) => Number(cfg?.port) || defaultPort(cfg?.source);

/** Stable health-registry key. Same shape as every other integration's. */
export const healthKey = (cfg) => `captions@${cfg?.host}:${port(cfg)}`;

/**
 * Hold a connection open, calling handlers as things arrive.
 *
 * `handlers` = { onChannels(list), onLine(CaptionLine), onUp(boolean) }.
 * Resolves when `signal` aborts. Never throws for a connection that simply
 * dropped — reconnection is the caller's loop, because only it knows whether
 * anybody is still watching.
 */
export function watch(cfg, handlers, signal) {
  const source = impl(cfg);
  if (!source) return Promise.resolve();
  return source.watch(cfg, handlers, signal);
}

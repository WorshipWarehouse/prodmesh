// ─────────────────────────────────────────────────────────────────────────────
//  ANALYSIS SOURCE  —  where a room's loudness numbers come from.
//
//  A room's `analysis` config picks one of the interchangeable SPL providers:
//
//    { source: 'smaart', host, ... }   Rational Acoustics Smaart (smaart.js)
//    { source: 'rta',    host, ... }   ProdMesh Remote RTA       (rta.js)
//    { source: 'open-sound-meter', … } Open Sound Meter multicast (openSoundMeter.js)
//    { mock: true, ... }               simulated meter for dev rooms
//
//  Both providers emit the same samples ({ ts, spl }) and honor the same
//  target/limit fields, so everything downstream (show reports, the live
//  meter, analytics) is source-agnostic. `source` defaults to 'smaart' —
//  pre-migration configs never named one.
// ─────────────────────────────────────────────────────────────────────────────
import * as smaart from './smaart.js';
import * as rta from './rta.js';
import * as openSoundMeter from './openSoundMeter.js';

export const SOURCES = ['smaart', 'rta', 'open-sound-meter'];

export const isConfigured = (cfg) => Boolean(cfg && (cfg.mock || cfg.host || cfg.source === 'open-sound-meter'));

export function watchSpl(cfg, onSample, signal, intervalMs = 1000) {
  // smaart.watchSpl also owns the mock loop, whatever the declared source.
  if (cfg?.mock || !cfg?.source || cfg.source === 'smaart') return smaart.watchSpl(cfg, onSample, signal, intervalMs);
  if (cfg.source === 'rta') return rta.watchSpl(cfg, onSample, signal, intervalMs);
  return openSoundMeter.watchSpl(cfg, onSample, signal, intervalMs);
}

// Only Smaart has controllable SPL logging — the RTA app always streams.
export const supportsLogControl = (cfg) =>
  Boolean(cfg?.host) && !cfg?.mock && (cfg?.source ?? 'smaart') === 'smaart';

export const setLogging = (cfg, on, signal) => smaart.setLogging(cfg, on, signal);

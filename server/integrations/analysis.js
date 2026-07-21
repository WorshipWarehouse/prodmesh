// ─────────────────────────────────────────────────────────────────────────────
//  ANALYSIS SOURCE  —  where a room's loudness numbers come from.
//
//  A room's `analysis` config picks one of the interchangeable SPL providers:
//
//    { source: 'smaart', host, ... }   Rational Acoustics Smaart (smaart.js)
//    { source: 'rta',    host, ... }   ProdMesh Remote RTA       (rta.js)
//    { mock: true, ... }               simulated meter for dev rooms
//
//  Both providers emit the same samples ({ ts, spl }) and honor the same
//  target/limit fields, so everything downstream (show reports, the live
//  meter, analytics) is source-agnostic. `source` defaults to 'smaart' —
//  pre-migration configs never named one.
// ─────────────────────────────────────────────────────────────────────────────
import * as smaart from './smaart.js';
import * as rta from './rta.js';

export const SOURCES = ['smaart', 'rta'];

export const isConfigured = (cfg) => Boolean(cfg && (cfg.mock || cfg.host));

export function watchSpl(cfg, onSample, signal, intervalMs = 1000) {
  // smaart.watchSpl also owns the mock loop, whatever the declared source.
  if (cfg?.mock || cfg?.source !== 'rta') return smaart.watchSpl(cfg, onSample, signal, intervalMs);
  return rta.watchSpl(cfg, onSample, signal, intervalMs);
}

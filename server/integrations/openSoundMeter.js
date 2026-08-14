// ─────────────────────────────────────────────────────────────────────────────
//  INTEGRATION: Open Sound Meter — room loudness (SPL).
//
//  Open Sound Meter's Remote API broadcasts UDP multicast `levels` packets.
//  This is intentionally not an HTTP/WebSocket client: enable Remote API Server
//  in OSM, then this listener joins the production LAN multicast group.
//
//   239.255.42.42:49007 ← { api: 'Open Sound Meter', message: 'levels',
//     source, objectName, data: { A: { Fast, Slow }, B: …, C: …, Z: … } }
//
//  OSM reports values against its internal full-scale reference. Its own SPL
//  display adds 140 dB, so ProdMesh applies the same reference and floors the
//  result at 0 dB SPL. A configured sourceId is honored; otherwise the first
//  observed OSM source stays selected for the watcher lifetime.
// ─────────────────────────────────────────────────────────────────────────────
import dgram from 'node:dgram';
import { report } from '../health.js';

export const MULTICAST_GROUP = '239.255.42.42';
export const DEFAULT_PORT = 49007;
const SPL_OFFSET = 140;
let activeWatchers = 0;
const packetObservers = new Set();

export const isConfigured = (cfg) => Boolean(cfg && cfg.source === 'open-sound-meter');
export const healthKey = (cfg) => `analysis@osm:${MULTICAST_GROUP}:${cfg?.port ?? DEFAULT_PORT}`;

function selectedLevel(packet, cfg) {
  if (packet?.api !== 'Open Sound Meter' || packet?.message !== 'levels' || !packet.data) return null;
  const weighting = cfg.weighting ?? 'A';
  const response = cfg.response ?? 'Slow';
  const raw = packet.data?.[weighting]?.[response];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.max(0, raw + SPL_OFFSET);
}

export function sampleFromPacket(data, cfg, selectedSource) {
  let packet;
  try {
    packet = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
  } catch {
    // Some OSM versions emit a compact `key=value` levels packet. Accept the
    // same fallback ChurchBoard uses instead of silently declaring a healthy
    // multicast connection offline.
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    const fields = Object.fromEntries([...text.matchAll(/([A-Za-z_][\w.-]*)\s*[=:]\s*(-?\d+(?:\.\d+)?)/g)].map((m) => [m[1].toLowerCase(), Number(m[2])]));
    const raw = fields.a_slow ?? fields.slow ?? fields.slow_db;
    if (!Number.isFinite(raw)) return null;
    return { sourceId: selectedSource ?? '', sample: { ts: Date.now(), spl: Math.round(Math.max(0, raw + SPL_OFFSET) * 10) / 10 } };
  }
  const sourceId = String(packet.source ?? '');
  const expected = cfg.sourceId ?? selectedSource ?? sourceId;
  if (expected && sourceId !== expected) return null;
  const level = selectedLevel(packet, cfg);
  if (level == null) return null;
  return {
    sourceId: expected || sourceId,
    sample: {
      ts: Date.now(), spl: Math.round(level * 10) / 10,
      readings: Object.fromEntries(['A', 'B', 'C', 'Z'].flatMap((weighting) => ['Fast', 'Slow'].flatMap((response) => {
        const raw = packet.data?.[weighting]?.[response];
        return typeof raw === 'number' && Number.isFinite(raw) ? [[`SPL ${weighting} ${response}`, Math.round((raw + SPL_OFFSET) * 10) / 10]] : [];
      }))),
    },
  };
}

/** Listen to OSM's Remote API until aborted. */
export function watchSpl(cfg, onSample, signal) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let selectedSource = cfg.sourceId ?? null;
    let closed = false;
    activeWatchers += 1;
    const finish = (err) => {
      if (closed) return;
      closed = true;
      activeWatchers -= 1;
      signal?.removeEventListener('abort', onAbort);
      try { socket.close(); } catch { /* already closed */ }
      err ? reject(err) : resolve();
    };
    const onAbort = () => finish();
    signal?.addEventListener('abort', onAbort, { once: true });

    socket.once('error', finish);
    socket.on('message', (data) => {
      for (const observer of packetObservers) observer(data);
      const parsed = sampleFromPacket(data, cfg, selectedSource);
      if (!parsed) return;
      selectedSource = parsed.sourceId;
      report(healthKey(cfg), true);
      onSample(parsed.sample);
    });
    socket.bind({ address: '0.0.0.0', port: cfg.port ?? DEFAULT_PORT, exclusive: false }, () => {
      try {
        socket.addMembership(MULTICAST_GROUP, cfg.interface || undefined);
      } catch (err) {
        finish(err);
      }
    });
  });
}

/** Wait for a real, matching Remote API level packet. This deliberately
 * validates the measurement that will drive the widget, not merely whether a
 * UDP port happened to be open. */
export function testConnection(cfg, timeoutMs = 5_000) {
  // A dashboard may already be listening for the live widget. macOS does not
  // allow a second socket to bind this multicast port, so observe that shared
  // listener instead of competing with it (the former EADDRINUSE failure).
  if (activeWatchers > 0) return waitForPacket(cfg, timeoutMs);
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`No matching Open Sound Meter level packet received within ${Math.ceil(timeoutMs / 1000)} seconds`));
    }, timeoutMs);
    watchSpl(cfg, (sample) => {
      clearTimeout(timer);
      controller.abort();
      resolve({ detail: `Receiving ${cfg.weighting ?? 'A'}-${cfg.response ?? 'Slow'} SPL (${sample.spl.toFixed(1)} dB)` });
    }, controller.signal).catch((err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForPacket(cfg, timeoutMs) {
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); packetObservers.delete(onPacket); };
    const onPacket = (data) => {
      const parsed = sampleFromPacket(data, cfg, null);
      if (!parsed) return;
      done();
      resolve({ detail: `Receiving ${cfg.weighting ?? 'A'}-${cfg.response ?? 'Slow'} SPL (${parsed.sample.spl.toFixed(1)} dB)` });
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(`No matching Open Sound Meter level packet received within ${Math.ceil(timeoutMs / 1000)} seconds`));
    }, timeoutMs);
    packetObservers.add(onPacket);
  });
}

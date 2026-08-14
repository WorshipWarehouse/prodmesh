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
    return null;
  }
  const sourceId = String(packet.source ?? '');
  const expected = cfg.sourceId ?? selectedSource ?? sourceId;
  if (expected && sourceId !== expected) return null;
  const level = selectedLevel(packet, cfg);
  if (level == null) return null;
  return {
    sourceId: expected || sourceId,
    sample: { ts: Date.now(), spl: Math.round(level * 10) / 10 },
  };
}

/** Listen to OSM's Remote API until aborted. */
export function watchSpl(cfg, onSample, signal) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let selectedSource = cfg.sourceId ?? null;
    let closed = false;
    const finish = (err) => {
      if (closed) return;
      closed = true;
      signal?.removeEventListener('abort', onAbort);
      try { socket.close(); } catch { /* already closed */ }
      err ? reject(err) : resolve();
    };
    const onAbort = () => finish();
    signal?.addEventListener('abort', onAbort, { once: true });

    socket.once('error', finish);
    socket.on('message', (data) => {
      const parsed = sampleFromPacket(data, cfg, selectedSource);
      if (!parsed) return;
      selectedSource = parsed.sourceId;
      report(healthKey(cfg), true);
      onSample(parsed.sample);
    });
    socket.bind(cfg.port ?? DEFAULT_PORT, () => {
      try {
        socket.addMembership(MULTICAST_GROUP, cfg.interface || undefined);
      } catch (err) {
        finish(err);
      }
    });
  });
}

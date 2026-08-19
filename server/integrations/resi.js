import { getSecret } from '../secrets.js';
import { report } from '../health.js';

/** Resi's monitoring endpoints and response fields differ by account/API
 * product. Keep that variation server-side, and publish one small stable
 * shape to dashboard widgets. The configured URL is intentionally a complete
 * HTTPS endpoint rather than a guessed private Resi path. */
const CACHE_MS = 2_500;
let cached = null;
let pending = null;

export const healthKey = () => 'resi';
export const configured = () => Boolean(getSecret('resi.apiToken') && getSecret('resi.statusUrl'));

function value(source, paths) {
  for (const path of paths) {
    const found = path.split('.').reduce((node, key) => node == null ? undefined : node[key], source);
    if (found != null && found !== '') return found;
  }
  return undefined;
}

function bool(source, paths) {
  const found = value(source, paths);
  return typeof found === 'boolean' ? found : undefined;
}

function number(source, paths) {
  const found = Number(value(source, paths));
  return Number.isFinite(found) ? found : undefined;
}

function text(source, paths) {
  const found = value(source, paths);
  return found == null ? undefined : String(found);
}

function severity(raw, live, encoderOnline, warnings, errors) {
  const status = String(raw ?? '').toLowerCase();
  if (/critical|fail|error|lost|disconnect|offline/.test(status) || errors.length) return live ? 'critical' : 'offline';
  if (/warn|degrad|poor/.test(status) || warnings.length) return 'warning';
  if (live || encoderOnline) return 'healthy';
  return 'offline';
}

/** Turn the common Resi/third-party monitor payload styles into the exact
 * values widgets need. Unknown payload fields are deliberately ignored —
 * dashboard clients never become an accidental Resi API proxy. */
export function normalize(payload) {
  const root = Array.isArray(payload) ? payload[0] ?? {} : payload?.data ?? payload?.broadcast ?? payload?.event ?? payload ?? {};
  const rawStatus = text(root, ['health.status', 'stream.health', 'status', 'state']);
  const streamStatus = text(root, ['stream.status', 'broadcast.status', 'status', 'state']);
  const liveFlag = bool(root, ['stream.live', 'broadcast.live', 'live', 'isLive']);
  const live = liveFlag ?? /live|streaming|active|healthy|warning/.test(String(streamStatus ?? rawStatus ?? '').toLowerCase());
  const encoderOnline = bool(root, ['encoder.online', 'encoder.connected', 'encoderOnline', 'online']);
  const warnings = value(root, ['health.warnings', 'warnings']) ?? [];
  const errors = value(root, ['health.errors', 'errors']) ?? [];
  const asList = (items) => Array.isArray(items) ? items.map(String) : items ? [String(items)] : [];
  const warningList = asList(warnings); const errorList = asList(errors);
  const health = severity(rawStatus, live, encoderOnline, warningList, errorList);
  return {
    connected: true,
    configured: true,
    live,
    health,
    title: text(root, ['stream.title', 'broadcast.title', 'event.name', 'name', 'title']) ?? 'Resi broadcast',
    encoder: { online: encoderOnline, name: text(root, ['encoder.name', 'encoder.label', 'encoderName']) },
    video: text(root, ['video.status', 'inputs.video.status', 'videoStatus']),
    audio: text(root, ['audio.status', 'inputs.audio.status', 'audioStatus']),
    destination: text(root, ['destination.status', 'destinations.0.status', 'destinationStatus']),
    startedAt: text(root, ['stream.startedAt', 'broadcast.startedAt', 'startedAt', 'startTime']),
    viewers: number(root, ['analytics.currentViewers', 'viewers.current', 'currentViewers', 'viewers']),
    peakViewers: number(root, ['analytics.peakViewers', 'viewers.peak', 'peakViewers']),
    totalViews: number(root, ['analytics.totalViews', 'totalViews']),
    averageWatchTime: text(root, ['analytics.averageWatchTime', 'averageWatchTime']),
    warnings: warningList,
    errors: errorList,
    playerUrl: getSecret('resi.playerUrl') || null,
    capabilities: {
      player: Boolean(getSecret('resi.playerUrl')),
      viewers: number(root, ['analytics.currentViewers', 'viewers.current', 'currentViewers', 'viewers']) != null,
      telemetry: Boolean(encoderOnline != null || rawStatus || warningList.length || errorList.length),
    },
  };
}

async function load() {
  if (!configured()) return { connected: false, configured: false, live: false, health: 'offline', title: 'Resi is not configured', error: 'Add a Resi API token and monitoring API URL in Settings.', playerUrl: getSecret('resi.playerUrl') || null, capabilities: { player: Boolean(getSecret('resi.playerUrl')), viewers: false, telemetry: false } };
  const url = getSecret('resi.statusUrl');
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Resi Monitoring API URL must be a valid absolute URL'); }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') throw new Error('Resi Monitoring API URL must use HTTPS');
  const response = await fetch(parsed, { headers: { Authorization: `Bearer ${getSecret('resi.apiToken')}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Resi API request failed (${response.status})`);
  const result = normalize(await response.json());
  report(healthKey(), true);
  return result;
}

export async function status({ force = false } = {}) {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (!pending) pending = load().then((result) => { cached = { at: Date.now(), value: result }; return result; }).catch((err) => {
    report(healthKey(), false, String(err.message ?? err));
    return { connected: false, configured: configured(), live: false, health: 'connection-lost', title: 'Resi connection lost', error: String(err.message ?? err), playerUrl: getSecret('resi.playerUrl') || null, capabilities: { player: Boolean(getSecret('resi.playerUrl')), viewers: false, telemetry: false } };
  }).finally(() => { pending = null; });
  return pending;
}

export function clearCache() { cached = null; }

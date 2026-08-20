// Read-only receiver telemetry for the ProdMesh Wireless board. A receiver is
// shared by several channels, so each request polls it once and maps the
// result back to the configured inventory records.
import net from 'node:net';
import dgram from 'node:dgram';

const FRAME = /<\s*(?:REP|REPLY|REPORT|SAMPLE)\s+(\d+)\s+([A-Z_]+)(?:\s+\{?([^>}]*)\}?)?\s*>/g;
const cache = new Map();
const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const shurePercent = (value, max) => clamp((Number(value) / max) * 100);
const hostKey = (gear) => `${gear.vendor}:${gear.receiverHost}:${gear.receiverPort}`;

function shurePoll(host, port, channels) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let raw = '';
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(raw);
    };
    socket.setTimeout(1400, done);
    socket.on('error', done);
    socket.on('connect', () => {
      for (const channel of channels) {
        for (const key of ['CHAN_NAME', 'BATT_BARS', 'FREQUENCY', 'TX_TYPE']) socket.write(`< GET ${channel} ${key} >`);
        socket.write(`< SET ${channel} METER_RATE 100 >`);
      }
    });
    socket.on('data', (chunk) => { raw += chunk.toString(); });
    socket.on('end', done);
  });
}

function parseShure(raw, channels) {
  const states = new Map(channels.map((channel) => [channel, { receiverOnline: false, online: false, batteryPercent: null, batteryMinutes: null, rf: null, audio: null, muted: false, frequency: '', model: '', firmware: '', warnings: [] }]));
  for (const match of raw.matchAll(FRAME)) {
    const channel = Number(match[1]); const state = states.get(channel); if (!state) continue;
    const key = match[2]; const value = String(match[3] ?? '').trim(); state.receiverOnline = true;
    if (key === 'BATT_BARS') state.batteryPercent = Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 5 ? shurePercent(value, 5) : null;
    if (key === 'FREQUENCY') state.frequency = value;
    if (key === 'TX_TYPE') state.model = value;
    if (key === 'ALL') { const values = value.split(/\s+/); state.rf = shurePercent(values.at(-2), 115); state.audio = shurePercent(values.at(-1), 50); }
  }
  for (const state of states.values()) {
    state.online = Boolean(state.receiverOnline && (state.model && !/^(UNKN|UNKNOWN|NONE|OFF)$/i.test(state.model) || (state.batteryPercent ?? 0) > 0));
    if (!state.receiverOnline) state.warnings = ['Receiver unavailable'];
    else if (!state.online) state.warnings = ['Transmitter off'];
    else if ((state.batteryPercent ?? 100) <= 10) state.warnings = ['Low battery'];
  }
  return states;
}

function sennheiserPoll(host, port, channels) {
  const request = { device: { product: null, firmware: null }, m: {}, mates: {} };
  for (const channel of channels) { request[`rx${channel}`] = { name: null, frequency: null }; request.m[`rx${channel}`] = { rssi: null, rsqi: null, af: null }; request.mates[`tx${channel}`] = { name: null, mute: null, battery: { gauge: null, lifetime: null }, warnings: null }; }
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let finished = false;
    const finish = (value) => { if (finished) return; finished = true; socket.close(); resolve(value); };
    const timeout = setTimeout(() => finish(null), 1500);
    socket.once('error', () => { clearTimeout(timeout); finish(null); });
    socket.once('message', (message) => { clearTimeout(timeout); try { finish(JSON.parse(message.toString())); } catch { finish(null); } });
    socket.send(Buffer.from(JSON.stringify(request)), port, host, (error) => { if (error) { clearTimeout(timeout); finish(null); } });
  });
}

function parseSennheiser(response, channels) {
  if (!response) return new Map(channels.map((channel) => [channel, { receiverOnline: false, online: false, batteryPercent: null, batteryMinutes: null, rf: null, audio: null, muted: false, frequency: '', model: '', firmware: '', warnings: ['Receiver unavailable'] }]));
  const device = response?.device ?? {};
  return new Map(channels.map((channel) => {
    const rx = response?.[`rx${channel}`] ?? {}; const meter = response?.m?.[`rx${channel}`] ?? {}; const tx = response?.mates?.[`tx${channel}`] ?? {}; const battery = tx.battery ?? {};
    const present = battery.gauge != null || tx.name || tx.mute != null;
    const batteryPercent = battery.gauge == null ? null : clamp(battery.gauge);
    const rf = meter.rsqi == null ? (meter.rssi == null ? null : clamp((Number(meter.rssi) + 107) / 107 * 100)) : clamp(meter.rsqi);
    const audio = meter.af == null ? null : clamp((Number(meter.af) + 60) / 60 * 100);
    const warnings = [...(tx.warnings ?? [])].map(String);
    if (!present) warnings.push('Transmitter off');
    if (tx.mute) warnings.push('Transmitter muted');
    if (present && (rf ?? 100) < 20) warnings.push('Weak RF signal');
    if ((batteryPercent ?? 100) <= 10) warnings.push('Low battery');
    const rawFrequency = rx.frequency;
    const frequency = rawFrequency == null ? '' : Number.isFinite(Number(rawFrequency)) ? `${(Number(rawFrequency) / 1000).toFixed(3)} MHz` : String(rawFrequency);
    return [channel, { receiverOnline: Boolean(response), online: Boolean(present), batteryPercent, batteryMinutes: battery.lifetime ?? null, rf, audio, muted: Boolean(tx.mute), frequency, model: String(device.product ?? ''), firmware: String(device.firmware ?? device.version ?? ''), warnings: [...new Set(warnings)] }];
  }));
}

async function pollReceiver(group) {
  const channels = [...new Set(group.gear.map((item) => Number(item.channel) || 1))];
  const isSennheiser = group.gear[0].vendor === 'Sennheiser';
  const state = isSennheiser
    ? parseSennheiser(await sennheiserPoll(group.host, group.port, channels), channels)
    : parseShure(await shurePoll(group.host, group.port, channels), channels);
  return group.gear.map((item) => [item.id, state.get(Number(item.channel) || 1)]);
}

export async function wirelessTelemetry(gear) {
  const networked = gear.filter((item) => item.connection === 'wireless' && item.receiverHost && item.receiverPort && (item.vendor === 'Shure' || item.vendor === 'Sennheiser'));
  const groups = new Map();
  for (const item of networked) { const key = hostKey(item); const group = groups.get(key) ?? { host: item.receiverHost, port: item.receiverPort, gear: [] }; group.gear.push(item); groups.set(key, group); }
  const results = await Promise.all([...groups.values()].map(async (group) => {
    const key = `${group.host}:${group.port}:${group.gear[0].vendor}`; const cached = cache.get(key);
    if (cached && Date.now() - cached.at < 2000) return cached.values;
    try { const values = await pollReceiver(group); cache.set(key, { at: Date.now(), values }); return values; }
    catch { return group.gear.map((item) => [item.id, { receiverOnline: false, online: false, batteryPercent: null, batteryMinutes: null, rf: null, audio: null, muted: false, frequency: '', model: '', firmware: '', warnings: ['Receiver unavailable'] }]); }
  }));
  return Object.fromEntries(results.flat());
}

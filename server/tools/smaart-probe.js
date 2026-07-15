// Diagnostic probe for a Smaart API server. Phase 1 sweeps each known API
// path, sends a few "hello" shapes, and prints every raw message received.
// Phase 2 deep-dives the first path that answered RPCs: server info → auth
// (if needed) → activeCalibratedInputs → connects to the first metric stream
// and dumps raw frames, including whether targetFPS throttling is honored.
//
//   node server/tools/smaart-probe.js <host> [port] [password]
//
// Read-only apart from stream targetFPS (which only affects this connection).
import WebSocket from 'ws';

const [host, portArg, password] = process.argv.slice(2);
if (!host) {
  console.error('usage: node server/tools/smaart-probe.js <host> [port] [password]');
  process.exit(1);
}
const port = Number(portArg) || 26000;

const PATHS = ['/api/v4/', '/api/v3/', '/api/v2/', '/api/v1/', '/api/', '/'];
// Different hello shapes across API generations — old versions may not use
// sequenceNumber, or may want an explicit target.
const HELLOS = [
  { sequenceNumber: 1, action: 'get' },
  { action: 'get' },
  { sequenceNumber: 2, action: 'get', target: 'activeCalibratedInputs' },
  ...(password ? [{ sequenceNumber: 3, action: 'set', properties: [{ password }] }] : []),
];

const stamp = () => new Date().toISOString().slice(11, 23);
const log = (tag, msg) => console.log(`${stamp()} [${tag}] ${msg}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { handshakeTimeout: 5000 });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`handshake rejected: HTTP ${res.statusCode}`)));
  });
}

// ── Phase 1: path sweep ──────────────────────────────────────────────────────

function probePath(path) {
  return new Promise((resolve) => {
    const result = { gotAnything: false, rpcLike: false };
    let ws;
    const finish = (why) => {
      log(path, `— done (${why}${result.gotAnything ? ', GOT DATA' : ', silent'})`);
      try { ws?.terminate(); } catch { /* already closed */ }
      resolve(result);
    };
    connect(`ws://${host}:${port}${path}`).then((sock) => {
      ws = sock;
      ws.on('close', (code, reason) => log(path, `closed (${code} ${reason || ''})`));
      ws.on('error', (err) => log(path, `error: ${err.message}`));
      ws.on('message', (data) => {
        result.gotAnything = true;
        const text = String(data);
        if (text.includes('"response"')) result.rpcLike = true;
        log(path, `<< ${text.slice(0, 2000)}`);
      });
      log(path, `connected — sending ${HELLOS.length} hello variants`);
      HELLOS.forEach((hello, i) =>
        setTimeout(() => {
          log(path, `>> ${JSON.stringify(hello)}`);
          try { ws.send(JSON.stringify(hello)); } catch { /* closed under us */ }
        }, i * 1500),
      );
      // Listen well past the last send so slow/unsolicited replies show up.
      setTimeout(() => finish('listen window over'), HELLOS.length * 1500 + 5000);
    }, (err) => {
      log(path, `error: ${err.message}`);
      finish('connect failed');
    });
  });
}

// ── Phase 2: deep dive on the path that answered ─────────────────────────────

async function deepDive(path) {
  console.log(`\n=== Deep dive: ${path} ===`);
  const ws = await connect(`ws://${host}:${port}${path}`);
  ws.on('message', (d) => log(path, `<< ${String(d).slice(0, 4000)}`));
  let seq = 10;
  const call = (req, ms = 5000) =>
    new Promise((resolve) => {
      const sequenceNumber = ++seq;
      const timer = setTimeout(() => { ws.off('message', onMsg); resolve(null); }, ms);
      const onMsg = (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.sequenceNumber !== sequenceNumber) return;
          clearTimeout(timer);
          ws.off('message', onMsg);
          resolve(msg.response ?? {});
        } catch { /* not JSON — the raw printer above already showed it */ }
      };
      ws.on('message', onMsg);
      log(path, `>> ${JSON.stringify({ sequenceNumber, ...req })}`);
      ws.send(JSON.stringify({ sequenceNumber, ...req }));
    });

  const info = await call({ action: 'get' });
  if (info?.authenticationRequired) {
    if (!password) {
      console.log('\n! authenticationRequired but no password given — pass it as the 3rd argument and re-run.');
      ws.close();
      return;
    }
    await call({ action: 'set', properties: [{ password }] });
  }
  const inputs = await call({ action: 'get', target: 'activeCalibratedInputs' });
  ws.close();

  const channels = (inputs?.devices ?? []).flatMap((d) =>
    (d.activeCalibratedChannels ?? []).map((c) => ({ ...c, deviceName: d.deviceName })),
  );
  if (!channels.length) {
    console.log(
      '\nNo active calibrated inputs. In Smaart, start SPL metering/logging on a ' +
        'calibrated mic input, then re-run this probe to capture the metric stream.',
    );
    return;
  }
  const target = channels.find((c) => c.streamEndpoint);
  if (!target) {
    console.log(`\nChannels found but none advertise a streamEndpoint: ${JSON.stringify(channels)}`);
    return;
  }

  console.log(`\n--- Metric stream: ${target.deviceName}/${target.channelName} (${target.streamEndpoint}) ---`);
  const stream = await connect(`ws://${host}:${port}${target.streamEndpoint}`);
  let frames = 0;
  stream.on('message', (d) => { frames += 1; log('stream', `<< ${String(d).slice(0, 1000)}`); });
  await wait(2500);
  log('stream', '>> {"action":"set","properties":[{"targetFPS":1}]}  (watch whether the frame rate drops)');
  stream.send(JSON.stringify({ action: 'set', properties: [{ targetFPS: 1 }] }));
  await wait(5000);
  stream.close();
  console.log(`(${frames} stream frames total)`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log(`Probing ws://${host}:${port} (password ${password ? 'provided' : 'not provided'})`);
const answering = [];
for (const path of PATHS) {
  // Sequential on purpose: interleaved output from parallel sockets is unreadable.
  const result = await probePath(path);
  if (result.rpcLike) answering.push(path);
}
if (answering.length) {
  try {
    await deepDive(answering[0]);
  } catch (err) {
    console.log(`Deep dive failed: ${err.message}`);
  }
} else {
  console.log('\nNo path answered RPCs — nothing to deep-dive.');
}
console.log('\nProbe complete. Paste this whole output back for analysis.');

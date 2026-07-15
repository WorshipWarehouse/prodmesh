// Diagnostic probe for a Smaart API server. Connects to each known API path,
// sends a few "hello" shapes, and prints every raw message received, so we can
// see which API version/dialect a given Smaart installation actually speaks.
//
//   node server/tools/smaart-probe.js <host> [port] [password]
//
// Read-only: only sends `get` requests (plus a password if one is provided).
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
const log = (path, msg) => console.log(`${stamp()} [${path}] ${msg}`);

function probePath(path) {
  return new Promise((resolve) => {
    const url = `ws://${host}:${port}${path}`;
    const ws = new WebSocket(url, { handshakeTimeout: 5000 });
    let gotAnything = false;

    const finish = (why) => {
      log(path, `— done (${why}${gotAnything ? ', GOT DATA' : ', silent'})`);
      try { ws.terminate(); } catch { /* already closed */ }
      resolve(gotAnything);
    };

    ws.on('unexpected-response', (_req, res) => {
      log(path, `handshake rejected: HTTP ${res.statusCode}`);
      finish('rejected');
    });
    ws.on('error', (err) => { log(path, `error: ${err.message}`); finish('error'); });
    ws.on('close', (code, reason) => log(path, `closed (${code} ${reason || ''})`));
    ws.on('message', (data) => {
      gotAnything = true;
      log(path, `<< ${String(data).slice(0, 2000)}`);
    });
    ws.on('open', () => {
      log(path, `connected — sending ${HELLOS.length} hello variants`);
      HELLOS.forEach((hello, i) =>
        setTimeout(() => {
          log(path, `>> ${JSON.stringify(hello)}`);
          try { ws.send(JSON.stringify(hello)); } catch { /* closed under us */ }
        }, i * 1500),
      );
      // Listen well past the last send so slow/unsolicited replies show up.
      setTimeout(() => finish('listen window over'), HELLOS.length * 1500 + 5000);
    });
  });
}

console.log(`Probing ws://${host}:${port} (password ${password ? 'provided' : 'not provided'})`);
for (const path of PATHS) {
  // Sequential on purpose: interleaved output from parallel sockets is unreadable.
  await probePath(path);
}
console.log('Probe complete. Paste this whole output back for analysis.');

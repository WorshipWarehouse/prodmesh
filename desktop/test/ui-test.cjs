// Status-window wiring test.
//
//   npm test --prefix desktop
//
// Drives the REAL preload.cjs and the REAL status.html in a real BrowserWindow
// and asserts that clicking "Open dashboard" reaches the main process.
//
// This exists because that button silently did nothing once. The preload had
// called `shell.openExternal` — and preloads are SANDBOXED by default since
// Electron 20, so `shell` is undefined there. The failure surfaced only as an
// uncaught error in the renderer console, which nobody is looking at, so the
// app looked fine and the button was simply dead.
//
// Not part of `npm test` at the repo root: it needs Electron and a window
// server, which the server and jsdom suites deliberately do not.

const { app, BrowserWindow, ipcMain } = require('electron');
const { writeSync } = require('node:fs');
const { join } = require('node:path');

const DESKTOP = join(__dirname, '..');
const TIMEOUT_MS = 8000;

let failures = 0;
const log = (msg) => writeSync(1, `${msg}\n`);
const pass = (msg) => log(`  ok  ${msg}`);
const fail = (msg) => { failures += 1; log(`  FAIL  ${msg}`); };

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(DESKTOP, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // A renderer error is how the original bug hid, so surface them.
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) log(`  renderer error: ${message}`);
  });

  const opened = new Promise((resolve) => ipcMain.once('prodmesh:open', () => resolve(true)));
  const bail = setTimeout(() => {
    fail('clicking "Open dashboard" produced no IPC — the button does nothing');
    finish();
  }, TIMEOUT_MS);

  function finish() {
    clearTimeout(bail);
    log(failures ? `\n${failures} failure(s)` : '\nall ok');
    app.exit(failures ? 1 : 0);
  }

  await win.loadFile(join(DESKTOP, 'status.html'));

  // Nothing should be actionable before the server reports in.
  const disabledAtFirst = await win.webContents.executeJavaScript(
    "document.getElementById('open').disabled",
  );
  if (disabledAtFirst) pass('the open button starts disabled');
  else fail('the open button was enabled before any state arrived');

  win.webContents.send('prodmesh:state', {
    status: 'running',
    port: 8080,
    error: null,
    version: '1.1.0',
    dataDir: '/tmp/example',
    urls: ['http://192.0.2.9:8080'],
    url: 'http://localhost:8080',
  });
  await new Promise((r) => setTimeout(r, 400));

  const state = await win.webContents.executeJavaScript(`(() => ({
    enabled: !document.getElementById('open').disabled,
    status: document.getElementById('stateText').textContent,
    // The LAN address is the thing someone reads off this window and types
    // into another machine, so it has to actually render.
    lan: document.getElementById('addrs').textContent,
  }))()`);

  if (state.enabled) pass('a running state enables the open button');
  else fail('the open button stayed disabled while running');
  if (/8080/.test(state.status)) pass('the window reports the port');
  else fail(`the window did not report the port (got "${state.status}")`);
  if (state.lan.includes('192.0.2.9:8080')) pass('the LAN address is shown, not just localhost');
  else fail(`the LAN address is missing (got "${state.lan}")`);

  await win.webContents.executeJavaScript("document.getElementById('open').click()");
  await opened;
  pass('clicking "Open dashboard" reaches the main process');
  finish();
});

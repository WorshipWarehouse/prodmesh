// The status window's only channel to the main process.
//
// CommonJS on purpose: Electron preload scripts are not ES modules unless the
// window opts in with sandbox:false + type:module, and there is nothing here
// worth that complication.
//
// Deliberately one-way and read-only. The window shows what the server is
// doing; every ACTION (open, quit, reveal folders) lives in the tray menu,
// where it is one code path rather than two. So this exposes no way to make
// anything happen.
const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('prodmesh', {
  onState: (fn) => {
    ipcRenderer.on('prodmesh:state', (_e, state) => fn(state));
  },
  // The one exception: opening the dashboard. It is the primary thing a first
  // run needs to do, and burying it in the menu bar on a machine nobody has
  // set up yet would be a poor first five minutes. openExternal only ever
  // reaches the local dashboard URL the main process reported.
  open: (url) => {
    if (/^http:\/\/(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+):\d+\/?$/.test(url)) {
      shell.openExternal(url);
    }
  },
});

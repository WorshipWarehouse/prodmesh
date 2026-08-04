// The status window's only channel to the main process.
//
// CommonJS on purpose: Electron preload scripts are not ES modules unless the
// window opts in with sandbox:false + type:module, and there is nothing here
// worth that complication.
//
// ONLY ipcRenderer AND contextBridge ARE AVAILABLE HERE. Preloads are
// sandboxed by default since Electron 20, so most of the electron module —
// `shell` very much included — is undefined. Calling it fails silently and the
// UI simply does nothing, which is exactly the bug this file used to have.
// Anything that acts on the machine belongs in main.js, reached over IPC.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prodmesh', {
  onState: (fn) => {
    ipcRenderer.on('prodmesh:state', (_e, state) => fn(state));
  },
  // Note there is no URL parameter. The main process already knows what it is
  // serving, so the window cannot influence what gets opened — which is a
  // stronger guarantee than validating a URL the renderer supplied.
  open: () => ipcRenderer.send('prodmesh:open'),
});

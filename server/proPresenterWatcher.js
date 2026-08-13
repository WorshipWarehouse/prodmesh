// Refcounted ProPresenter console state. The first load is deliberately rich;
// subsequent frames keep only runtime state so a cue advance never re-sends a
// whole playlist or forces the browser to rebuild its scrolling list.
import { rooms } from './roomsStore.js';
import * as hub from './streamHub.js';
import * as pp from './integrations/proPresenter.js';

const watchers = new Map();
const states = new Map();
// Keep the last rich playlist across SSE/browser watcher restarts. Device
// polling is deliberately ref-counted, but an operator should not lose their
// console merely because a tab briefly reconnects or PP has a short outage.
const lastUsablePlaylists = new Map();
export const proPresenterTopic = (roomId) => `room:${roomId}:propresenter`;

const wait = (ms, signal) => new Promise((resolve) => {
  if (signal.aborted) return resolve();
  const t = setTimeout(resolve, ms); t.unref?.();
  signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

async function watch(roomId, signal) {
  let playlistKey = '';
  let previousRuntime = '';
  let lastUsablePlaylist = lastUsablePlaylists.get(roomId) ?? null;
  while (!signal.aborted) {
    const config = rooms[roomId]?.proPresenter;
    try {
      if (!pp.isConfigured(config)) throw new Error('not configured');
      let next = await pp.readConsoleState(config, signal);
      // The focused endpoint occasionally emits a transient empty result while
      // PP changes selection. Preserve the last complete playlist during that
      // blip so the operator never sees a false "No focused playlist" state.
      if (next.focusedPlaylist?.items?.length) {
        lastUsablePlaylist = next.focusedPlaylist;
        lastUsablePlaylists.set(roomId, lastUsablePlaylist);
      }
      else if (lastUsablePlaylist) next = { ...next, focusedPlaylist: lastUsablePlaylist };
      const key = JSON.stringify(next.focusedPlaylist);
      const runtime = JSON.stringify(next.runtime);
      const full = key !== playlistKey;
      if (full || runtime !== previousRuntime) {
        playlistKey = key; previousRuntime = runtime;
        const payload = full ? { ...next, full: true, connected: true }
          : { runtime: next.runtime, full: false, connected: true };
        states.set(roomId, full ? payload : { ...states.get(roomId), ...payload });
        hub.publish(proPresenterTopic(roomId), payload);
      }
    } catch {
      const payload = { full: false, connected: false, runtime: null };
      if (previousRuntime !== 'offline') { previousRuntime = 'offline'; hub.publish(proPresenterTopic(roomId), payload); }
    }
    await wait(1000, signal);
  }
}

function start(roomId) {
  if (watchers.has(roomId)) return;
  const cached = lastUsablePlaylists.get(roomId);
  // `subscribe()` calls start before snapshot(), so seed a reconnecting
  // browser synchronously with the last usable playlist rather than a blank
  // "No focused playlist" panel while the new device poll starts.
  if (cached && !states.has(roomId)) {
    states.set(roomId, { focusedPlaylist: cached, activePlaylist: null, runtime: null, full: true, connected: false });
  }
  const controller = new AbortController(); watchers.set(roomId, controller);
  watch(roomId, controller.signal).catch(() => {});
}
function stop(roomId) { watchers.get(roomId)?.abort(); watchers.delete(roomId); states.delete(roomId); }

hub.registerTopic('room:*:propresenter', {
  valid: (roomId) => Boolean(rooms[roomId]), start, stop,
  snapshot: (roomId) => states.get(roomId),
});

export function stopAll() { for (const roomId of [...watchers.keys()]) stop(roomId); }

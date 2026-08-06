import { useSyncExternalStore } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
//  useTopic — live server values over ONE EventSource per browser tab.
//
//  Companion piece to useQuery: that one shares request/response data, this one
//  shares the push stream. A widget names a topic; the module keeps a single
//  connection carrying every topic anything on screen currently wants.
//
//  Why one connection matters: browsers allow six per origin on HTTP/1.1, and
//  this is a LAN appliance with no TLS and so no HTTP/2. A stream per room
//  meant a six-room wall display silently lost its sixth. See server/streamHub.js.
//
//  The topic set changes as widgets mount and unmount, and SSE is one-way — so
//  a change means reconnecting with a new query string. Reconnects are
//  debounced, which is the whole reason a twelve-widget page opens one
//  connection rather than twelve in sequence.
// ─────────────────────────────────────────────────────────────────────────────

type Listener = () => void;

const refs = new Map<string, number>(); // topic -> mounted subscribers
const listeners = new Map<string, Set<Listener>>();
const values = new Map<string, unknown>();

let source: EventSource | null = null;
let connected = ''; // the topic list `source` was opened with
let pending: ReturnType<typeof setTimeout> | null = null;

// Long enough to batch a page's worth of mounting widgets into one connection,
// short enough that nobody perceives it.
const CONNECT_DEBOUNCE_MS = 30;

function notify(topic: string) {
  const subs = listeners.get(topic);
  if (subs) for (const fn of subs) fn();
}

function wanted() {
  return [...refs.keys()].sort().join(',');
}

function connect() {
  pending = null;
  const topics = wanted();
  if (topics === connected && source) return;

  source?.close();
  source = null;
  connected = topics;
  if (!topics) return;

  const es = new EventSource(`/api/stream?topics=${encodeURIComponent(topics)}`);
  source = es;
  es.addEventListener('msg', (e) => {
    try {
      const { topic, data } = JSON.parse((e as MessageEvent).data);
      values.set(topic, data);
      notify(topic);
    } catch {
      /* a malformed frame must not tear down the connection */
    }
  });
  // No error handler: EventSource reconnects on its own, and on reconnect the
  // server re-sends every topic's current value. Adding our own retry on top
  // would just race with the browser's.
}

function schedule() {
  if (pending) clearTimeout(pending);
  pending = setTimeout(connect, CONNECT_DEBOUNCE_MS);
}

function acquire(topic: string) {
  refs.set(topic, (refs.get(topic) ?? 0) + 1);
  if (refs.get(topic) === 1) schedule();
}

function release(topic: string) {
  const n = (refs.get(topic) ?? 1) - 1;
  if (n > 0) {
    refs.set(topic, n);
    return;
  }
  refs.delete(topic);
  // Keep the last value: a widget that unmounts and remounts (a tab switch,
  // a re-render across a route change) should paint immediately rather than
  // flash empty while the reconnect and its snapshot land.
  schedule();
}

/**
 * Subscribe to one server topic, e.g. `room:north-main:spl`.
 * Returns undefined until the first value arrives.
 */
export function useTopic<T>(topic: string | null): T | undefined {
  return useSyncExternalStore(
    (onChange) => {
      if (topic == null) return () => {};
      let subs = listeners.get(topic);
      if (!subs) {
        subs = new Set();
        listeners.set(topic, subs);
      }
      subs.add(onChange);
      acquire(topic);
      return () => {
        subs.delete(onChange);
        if (!subs.size) listeners.delete(topic);
        release(topic);
      };
    },
    () => (topic == null ? undefined : (values.get(topic) as T | undefined)),
  );
}

/** Topic-name builders, so a typo is a compile error rather than a dead widget. */
export const roomTopic = {
  show: (roomId: string) => `room:${roomId}:show`,
  timer: (roomId: string) => `room:${roomId}:timer`,
  spl: (roomId: string) => `room:${roomId}:spl`,
  mode: (roomId: string) => `room:${roomId}:mode`,
  youtube: (roomId: string) => `room:${roomId}:youtube`,
  health: (roomId: string) => `room:${roomId}:health`,
};

/** Test hook: drop the connection and every cached value. */
export function resetStream() {
  if (pending) clearTimeout(pending);
  pending = null;
  source?.close();
  source = null;
  connected = '';
  refs.clear();
  listeners.clear();
  values.clear();
}

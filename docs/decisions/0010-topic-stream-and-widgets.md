# 0010 — One topic stream per browser

Status: accepted (2026-08-03) · supersedes the per-room stream in [0004](0004-server-coordinated-shows.md)

## Context

Run of Show was fed by one SSE endpoint per room, `/api/rooms/:id/show/stream`,
carrying a single fixed envelope: show state, current item, slide progress,
ProPresenter connectivity, the PP timer and SPL, all in one `state` event. For
one page looking at one room that was the right shape, and it worked.

1.5 wants custom Dashboard views: a stored grid of widgets, potentially
spanning rooms and campuses, that a church lays out for a wall display or a
booth screen. Three properties of the old design make that impossible rather
than merely awkward:

1. **Per-room streams don't compose.** A view of six rooms means six
   `EventSource`s. Browsers allow **six concurrent connections per origin on
   HTTP/1.1**, and prodmesh is a LAN appliance with no TLS and therefore no
   HTTP/2 — that is a deliberate part of the threat model, not an oversight.
   So the limit is real and unfixable at this layer: the sixth stream never
   opens, silently, and the page half-works with no error anywhere.

2. **A fixed envelope can't grow.** YouTube Live viewers, on-air state and
   whatever 1.5 brings would each widen one struct that then ships to every
   subscriber, whether or not their widgets render it. A slide change would
   re-send the loudness meter.

3. **Everything outside Run of Show polled independently.** Each `RoomCard`
   ran its own interval firing three requests, and `readRoomState()` reads
   Companion with no cache — so Home showing six rooms in three browsers was
   54 Companion reads a minute for six facts. A twelve-widget grid inherits
   that multiplication.

What the old design got right, and which had to survive: **watcher
refcounting**. Subscribing started the room's PP-timer and SPL watchers;
the last disconnect stopped them. Nobody polls ProPresenter for a room nobody
is looking at.

## Decision

One SSE connection per browser tab, carrying named topics.

- **`server/streamHub.js`** owns topics. A feature module claims a pattern with
  `registerTopic('room:*:spl', { valid, start, stop, snapshot })`. The hub
  refcounts subscribers and calls `start` on the first and `stop` on the last —
  the old lifecycle, generalized and hoisted out of the show manager.
- **`GET /api/stream?topics=a,b,c`** emits `{ topic, data }` frames. `valid`
  refuses topics naming an unknown room: subscribing *starts work*, so an
  unauthenticated endpoint that accepts any string is a resource-exhaustion
  primitive. Invalid topics are dropped individually rather than failing the
  connection — one stale widget in a saved dashboard must not blank the other
  eleven.
- **The room's state is three topics, not one envelope**: `room:<id>:show`,
  `room:<id>:timer`, `room:<id>:spl`, plus the new `room:<id>:mode`. A widget
  that wants only loudness no longer makes the server poll PP's timers.
- **`src/lib/stream.ts`** holds the single connection. `useTopic(topic)` is the
  push-side companion to `useQuery`: it refcounts topics across mounts and
  reconnects — debounced — when the set changes. Twelve widgets mounting
  together open one connection, not twelve.
- **`room:<id>:mode` is new.** One Companion poller per room regardless of how
  many screens watch it, published on change. `bump()` after a mode press
  pushes immediately, so every screen in the building moves together instead
  of each discovering it on its own interval.

`/api/rooms/:id/show/stream` **stays**, reimplemented as an adapter over the
same three topics. Room-Mac homepages and bookmarks point at views that use it,
and it is the one URL an operator can open raw to see whether the server is
alive. Being an adapter rather than a parallel implementation means the two
surfaces cannot drift.

## Consequences

- A dashboard of any size costs one connection. The six-connection ceiling
  stops being reachable.
- New live data is a new topic and a registration — no existing subscriber's
  payload changes.
- Home stops polling Companion per card per browser, and mode changes appear
  immediately rather than up to 30s later.
- The client's live data now has two mechanisms — `useQuery` for request/
  response, `useTopic` for push. That is a real cost in things-to-know, paid
  for by the fact that they compose: `RoomStatus` takes its first paint from
  `useQuery` and every subsequent value from `useTopic`, so the page never
  shows a spinner waiting for a socket.
- Tests need an `EventSource`, which jsdom lacks. It is stubbed globally in
  `src/test/setup.ts` so a component growing a live topic doesn't break the
  tests of whatever renders it.
- `streamHub.reset()` drops *all* registrations, so hub unit tests and tests
  that boot the app must live in different files (`streamHub.test.js` vs
  `streamApi.test.js`) — the usual one-process-per-boot-state rule.

## Not decided here

The widget registry and stored dashboard layouts. This ADR is the transport
they will need; the layout model is its own decision.

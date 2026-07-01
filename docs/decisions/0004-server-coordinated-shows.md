# ADR 0004 — Server-coordinated show sessions

Status: accepted · 2026-07-01

## Context

The first Run of Show cut ran a ProPresenter poller *per browser connection* and
recorded timing as a side effect of a browser being open. That's a proxy model,
not coordination: two booth screens = two pollers, recording stops if the page
closes, and there's no shared notion of "the service that's live right now."

## Decision

Make the **server the authoritative coordinator**. A **show** is a first-class
server-side session (`server/showManager.js`):

- **At most one active show per room.** `startShow` conflicts (409) if one is
  already active.
- The server runs **one ProPresenter poller per active show** (not per browser),
  tracks the current item + slide progress, and records the timeline. Recording is
  tied to the *show*, not to any browser being open.
- Browsers are **pure views**: they subscribe to a room-level SSE
  (`/api/rooms/:id/show/stream`) and render the broadcast state. Start / End /
  manual-override are server actions (`POST …/show/start|end|current`) that every
  connected view reflects instantly.
- Active shows are **persisted** (`server/data/shows/`) and **restored on boot**,
  so a server restart mid-service resumes the show (and its poller).

## Consequences

- Multiple booth screens/operators share one coordinated state — the point.
- Manual override and follow are server state, so all views agree.
- Recording no longer depends on a browser staying open.
- Sets the pattern for future live coordination (autostart, other live widgets):
  the server owns session state; frontends render it.
- Lifecycle is manual for now (Start/End buttons); **autostart** (e.g. from a
  Calendar booking or the room mode) is a later addition on this foundation.

## Notes

- The `showManager` is the single per-room poller + subscriber fan-out that ADR
  0002/0003 anticipated. `pollActive`→`pollRunState` still lives in the
  ProPresenter integration; the manager owns the lifecycle around it.

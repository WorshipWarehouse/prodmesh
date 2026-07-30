# ADR 0003 — Run of Show view (live per-service dashboard)

Status: accepted · 2026-07-01 · Phase 1 built

## Context

We want live "where are we in the service" tracking (driven by ProPresenter),
and eventually other live signals (stream viewers, loudness). The risk is
bolting all of this onto the Room Status page and bloating it.

## Decision

1. **A service instance is a first-class, routed entity.** A service time on the
   Room Status page is clickable → `/room/:roomId/run/:planId?time=:timeId`. That
   URL is the durable home for everything live about that service.

2. **The Run of Show view is a widget dashboard**, not a "ProPresenter page."
   It composes widgets, each backed by an integration — mirroring the tile /
   integration patterns. Today: a **countdown** widget and the **run-of-show
   tracker** (order of service with a current-item highlight). Later widgets
   (YouTube Live viewers, SMAART loudness, on-air) are additions, not rewrites.

3. **ProPresenter is a per-room streaming integration** (Phase 2). Each room has
   its own ProPresenter (Main `192.0.2.15`, Chapel `192.0.2.18`, Youth Room TBD). The
   backend connects server-side (LAN API, no CORS) and — since ProPresenter
   streams slide changes — relays updates to the browser via **SSE** (the first
   real use of push in this app). Target the **official API (7.9+)**. Mock-first.

4. **Mapping ProPresenter → the PC order of service.** The church pushes the PC
   plan into ProPresenter as a playlist, so the active playlist mirrors the PC
   order — enabling index/name matching to highlight the right item. Manual
   override always remains (reality ≠ plan happens live).

## Phasing

- **Phase 1 (built):** clickable service times → Run of Show route; order of
  service (existing PC data) + live countdown + **manual** current-item tracking
  (tap to set; persisted per-plan in localStorage). No ProPresenter dependency.
- **Phase 2:** per-room ProPresenter client + SSE; auto-advance the highlight via
  PP↔PC mapping; manual override stays.
- **Phase 3+:** additional widgets (stream viewers, loudness, …).

## Consequences

- The order-of-service rendering was extracted to a shared `OrderOfService`
  component (used read-only on Room Status, interactive here).
- A `GET /api/rooms/:id/plan/:planId` endpoint hydrates a specific plan.
- When Phase 2 lands, a formal widget registry may be worth it (once there are
  4+ widgets); today the composition is light and explicit.

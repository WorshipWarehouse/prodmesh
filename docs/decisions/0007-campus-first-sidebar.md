# 0007 — Campus-first sidebar navigation

Date: 2026-07-06 · Status: accepted

## Context

The top-bar shell (ADR 0005) was room-centric: a room switcher in the chrome,
and every page lived under `/room/:id`. That worked for one campus and a
handful of rooms, but the vision is multi-site (South Campus opens Dec 2026),
and new top-level surfaces were arriving that aren't about a single room at
all: the upcoming-events list, and analytics over the SQLite history.

## Decision

Replace the top bar with a **left sidebar, campus-first** information
architecture:

- **Sidebar** (collapsible to an icon rail, persisted per browser; narrow
  screens force the rail): church brand + **campus picker** ("All Campuses"
  or one site) at top; **Home / Services / Analytics / Admin** nav; **User**
  pinned at the bottom (a placeholder — station label + version — until the
  auth pillar lands).
- **Rooms are cards, not chrome.** Home shows the selected campus's rooms as
  live status cards (mode, LIVE badge, next event); clicking one enters the
  existing room-level pages, which keep their `/room/:id…` URLs so room-Mac
  homepages never break.
- **Services** is the campus-wide upcoming-events list; each row opens the
  Event Detail page (times, notes, startup checklist) — the operational front
  door to a service.
- **Analytics** is the show history: every recorded timeline joined with SPL
  aggregates, linking to the full report. Trend charts come later, on this
  same endpoint's data.
- The campus filter is client-side context (`CampusContext`); rooms carry a
  `site` id from the server. Rooms without a site are never filtered out —
  misconfiguration must not hide a room.

## Consequences

- New server surface: `GET /api/history` (all timelines + SPL aggregates) and
  `GET /api/about` (version). Timelines are now **labeled at show start**
  (`timeline.ensure`: plan title, service type, date, time name) so history
  stays readable long after a plan leaves Planning Center's "upcoming" window;
  older unlabeled timelines fall back to ids.
- The Quick Access launcher lives on Home below the room cards; the old
  standalone launcher page and the services-overview strip are gone.
- `/settings` redirects to `/admin`.
- Adding a campus = a site entry in `dashboard.config.ts` + `site:` ids on its
  rooms in `rooms.config.js`.

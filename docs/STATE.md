# Project state & roadmap

A living snapshot of what's live vs mock and what's next. Update this as things
change — it's the fastest way for a cold context to know where the project stands.
The long-term destination lives in [VISION.md](./VISION.md).
Last updated: 2026-07-06.

## Sites & rooms

**North** (active). **South Campus** — status `coming-soon`, shown as DISABLED,
opens Dec 2026, no rooms wired yet.

| Room | Companion | Modes | Planning Center |
|---|---|---|---|
| Auditorium (`north-main`) | **live** — 192.0.2.31, var `roomState`, buttons pg3 | Sunday/Second Service/Midweek/Evening/Event/Standby (real) | **live** — Sunday, Second Service, Midweek, Evening |
| Youth (`north-youth`) | mock — 192.0.2.150 (config ready) | standard set (Sunday/Mid-Week/Event/Standby) — **real modes unknown** | **live** — Youth Service |
| Chapel (`north-chapel`) | mock — 192.0.2.101 (config ready) | standard set — **real modes unknown** | **live** — Chapel Service |
| Local Test (`local-test`) | live — 127.0.0.1 (dev fixture) | standard set | live — Sunday (demo) |

Notes:
- Companion "live" means `mock: false`; it only actually reaches Companion when the
  server runs on/with network access to that host.
- Youth/Chapel use placeholder button locations (pg1/row3/1-4) and the standard mode set
  until their real modes + button locations are provided (Auditorium's are real).

## Integrations

| Integration | Status |
|---|---|
| Bitfocus Companion (per room) | Live for Auditorium; Youth/Chapel mock pending real setup |
| Planning Center **Services** | **Live** — plan display + order of service, PAT in `server/data/secrets.json` |
| Planning Center **Calendar** | **Not started** — awaiting read-only access. High value (see below) |
| **Smaart SPL** | **Transport implemented** (SDK v4 doc received 2026-07-06) — full pipeline (capture → SQLite → live meter + report, ADR 0006) + real WebSocket transport (auth → `activeCalibratedInputs` → SPL metric stream, tested against a protocol-faithful fake). Remaining: enable API in Smaart on the FOH Mac, set `smaart.host` in rooms.config, verify on-site. Rooms stay `mock: true` until then |

## What's live right now

- **Campus-first sidebar shell** (ADR 0007, supersedes 0005's top bar):
  collapsible left sidebar with campus picker (All Campuses / per site),
  nav = Home · Services · Analytics · Admin, User slot pinned at bottom
  (placeholder until auth). Widget-grid pages (`Widget`/`WidgetGrid`), CSS
  tokens + per-feature files.
  - **Home**: campus rooms as live status cards (mode, LIVE, next event)
    + the Quick Access launcher (Companion / Screen Share / device UIs).
  - **Services**: campus-wide upcoming events → Event Detail pages.
  - **Analytics**: show history (timelines + SPL from SQLite) → full reports.
    Timelines are labeled at show start so history outlives PC's "upcoming".
  - Room pages keep their `/room/:id…` URLs (room-Mac homepages unaffected);
    `/settings` → `/admin`.
- Room Status mode control with confirm + schedule-based **lockouts** (Override PIN).
- Settings UI: Admin/Override PINs, schedule editor, system self-update.
- PC Services plan display on Quick Access + Room Status (real data).
- Run of Show: **server-coordinated show sessions** (one active per room, Start/End
  buttons, browsers are views — see ADR 0004) with live ProPresenter follow, slide
  progress, and a **timing report** (planned vs actual per item) for debriefs.
  Ended shows stay marked **✓ Complete** (reopenable). The countdown widget follows
  the room's **PP service-start timer** when it's running (Message-driven, works
  between services); falls back to PC clock math otherwise.
- **Show automation** (per event, Event Detail → Show Automation widget): pick the
  PC item that **autostarts** the show when ProPresenter lands on it (edge-triggered,
  so "Pre-Service Slides" can loop between services harmlessly) and the item whose
  **last slide auto-completes** it. Autostart picks the right service time by clock,
  skipping already-completed ones; a per-room watcher polls PP only inside the arm
  window (2h before first service → 1h after last), zero browsers required. Manual
  **PC→PP mapping overrides** per event handle drifted orders (stored in SQLite
  `show_config`; live shows pick up edits). PP quirk (verified): `playlist_item`
  reads null right after an item trigger until the next slide action — baseline
  keeps last mapped item.
- **Event Detail page + startup checklists** (live-tested 2026-07-06): clicking the
  event title opens `/room/:id/event/:planId` — service/rehearsal times, PC series
  artwork, plan notes, and a **startup checklist**. Templates are per PC **event
  type** (service type id, `'*'` default) in `server/data/checklists.json`,
  **editable in Admin → Checklists** (add/remove/reorder items, mark one as an
  automated mode-set; admin-PIN gated). One template covers the event type in
  every room it runs in — the room supplies execution context. Run state is
  per-event in SQLite (shared across browsers). Automated items press the real
  Companion button via the shared mode path, so schedule lockouts still apply.
- Deploy/update scripts (launchd/systemd), tests, CI.

## Roadmap / open threads (roughly prioritized)

1. **Run of Show — Phase 2 (ProPresenter live tracking) — WORKING (verified live).**
   Per-room ProPresenter client (`integrations/proPresenter.js`) + SSE endpoint
   (`/api/rooms/:id/run/:planId/stream`) stream the active playlist item; the view
   auto-advances in "follow" mode with manual override. Official API on port
   **62202** (not 49310 = legacy WS). Mapping is by playlist index (PC push
   preserves order) with tolerant name fallback. See ADR 0003.
   - Verified: triggering slides moves the highlight (~1s). Note: PP's
     `?chunked=true` does NOT push item changes, so we poll `/v1/playlist/active`.
   - Remaining: set each room's real PP API port on-site (PP picks an ephemeral
     port per machine); wire Youth (PP host TBD).
2. **PC Calendar integration** — authoritative event→room→time. Unlocks:
   auto-populating lockout windows from real bookings (retire manual schedules),
   and confidently mapping "Special Events" to the right room.
3. **Youth/Chapel go live** — get their real modes + Companion button locations, flip
   `mock: false`. (Auditorium is the template.)
4. **Room-Mac browser homepages** — set each room Mac to `http://<box>:8080/room/<id>`.
5. **Confirm production deployment** on the Producer Mac via `deploy/install-service.sh`
   (dev has happened on jbeale's Mac; verify the box is running the service).
6. **Later widgets on Run of Show:** YouTube Live viewers, SMAART loudness, on-air.

## Deferred tech debt (known, low-risk)

- Frontend component tests (backend is covered).
- PIN brute-force throttling on `/api/auth/admin`.
- Backend TypeScript (currently plain JS).
- In-memory sessions reset on server restart (admins re-login).

## Decisions on hold pending info

- **Auditorium "Special Events"** mapping omitted until Calendar can confirm room.
- **South Campus** rooms/config — after the Dec 2026 opening.

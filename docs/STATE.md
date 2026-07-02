# Project state & roadmap

A living snapshot of what's live vs mock and what's next. Update this as things
change — it's the fastest way for a cold context to know where the project stands.
The long-term destination lives in [VISION.md](./VISION.md).
Last updated: 2026-07-02.

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

## What's live right now

- **App shell UI** (ADR 0005): persistent top bar (brand, room switcher,
  Status | Run of Show tabs, clock, settings), widget-grid pages
  (`Widget`/`WidgetGrid`), CSS split into design tokens + per-feature files.
  Room Status is the first widget page; Run of Show/Settings kept internals.
- Quick Access launcher (Companion / Screen Share / device web UIs), per room.
- Room Status mode control with confirm + schedule-based **lockouts** (Override PIN).
- Settings UI: Admin/Override PINs, schedule editor, system self-update.
- PC Services plan display on Quick Access + Room Status (real data).
- Run of Show: **server-coordinated show sessions** (one active per room, Start/End
  buttons, browsers are views — see ADR 0004) with live ProPresenter follow, slide
  progress, and a **timing report** (planned vs actual per item) for debriefs.
  Ended shows stay marked **✓ Complete** (reopenable). The countdown widget follows
  the room's **PP service-start timer** when it's running (Message-driven, works
  between services); falls back to PC clock math otherwise.
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

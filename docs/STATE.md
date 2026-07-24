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
| Local Test (`local-test`) | live — 127.0.0.1 (dev fixture; **opt-in via `PRODMESH_LOCAL_TEST=1`**, set by the npm dev scripts — hidden in production) | standard set | live — Sunday (demo) |

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
| **Smaart SPL** | **Transport implemented; v8 compat added 2026-07-14** — full pipeline (capture → SQLite → live meter + report) + real WebSocket transport (auth → `activeCalibratedInputs` → SPL metric stream). FOH Mac probe (2026-07-14) found **Smaart v8 (8.5.2.2)**: its `/api/v4/` socket accepts connections but never answers RPCs; the same dialect lives at `/api/v3/`. Transport now negotiates v4 → v3 and caches the answering path (`smaart.apiPath` pins it). Since 2026-07-18 Smaart is one of two interchangeable **analysis sources** (see `integrations/analysis.js`); ProdMesh Remote RTA is the free alternative. **Live at FOH 2026-07-21**: starting SPL logging in Smaart lit the dashboard meter — metering alone isn't enough, inputs must be calibrated + logging; shows can now drive logging on/off via `analysis.logControl`. Remaining: enumerate `get commands` on the FOH v8 to confirm it exposes "Toggle SPL Logging" (verified on v9) |

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
- **User-management foundation** (ADR 0008, feature branch): one-time named
  station registration per browser, anonymous read-only operation, contextual
  named-user login/lock, SQLite users + permission groups + extensible dotted
  ACLs, built-in Administrators wildcard, optional Planning Center person ID,
  login throttling, and user+station audit records. Admin → Users & permissions
  creates groups/users and assigns memberships. Legacy Admin PIN remains the
  bootstrap credential. Representative writes now enforced server-side: room
  modes, checklist completion, show operation/config, templates, settings, and
  updates.
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
- **Admin → Logs** (2026-07-14): server process log tail (the file
  `install-service.sh` writes; filter box, line-count picker, 5s auto-refresh)
  and the **audit trail** (who did what, from which station, allowed/denied)
  side by side. Guarded by the `system.logs` permission; `PRODMESH_LOG_FILE`
  overrides the log path for tests/unusual deployments.
- Deploy/update scripts (launchd/systemd), tests, CI. The automated suite now
  combines **125 server tests** with **16 frontend interaction/configuration tests**
  (Vitest + Testing Library); CI runs build, both test layers, and lint. See
  `docs/TESTING.md` for the required pattern as configuration moves into Admin,
  and `docs/UI_TEXT.md` for UI copy principles (terse labels, HelpTip for
  supplementary info, no intro paragraphs).
- **Station identity + named users** (feature branch): each browser registers a
  station name once, then remains a read-only dashboard until an operator signs
  in. Users inherit extensible permissions from groups; the Administrators system
  group grants all actions. Admin is split into General, Users & access, and
  Checklists subpages. The account menu requires confirmation before returning a
  station to read-only mode. When a user has a Planning Center Services Person ID,
  their Services profile thumbnail is shown as their avatar.
- **Station management** (feature branch): Admin → Stations lists registered
  browsers with current-station and last-seen status. Administrators can rename
  stations, assign campus/room context, or revoke them. Revocation invalidates
  sessions created at that station; revoking the current browser returns it to
  first-run registration. Guarded by the extensible `stations.manage` permission.
- **Room configuration page** (2026-07-15): Admin → Campuses is a site/room
  overview (institution name, site chips, room rows with tile counts); each
  room's **Configure** opens `/admin/campuses/<roomId>` with Identity (name,
  site, stable room id), the Quick Access tile editor, and a Connectivity
  section that will absorb `rooms.config.js` one integration at a time.
  Rooms added in an unsaved draft show "save to configure" until saved.
  **Connectivity, first migration (2026-07-15): Planning Center service
  types** live in SQLite (`room_connectivity`, seeded from rooms.config.js
  on first boot) and are edited on the room page; saves apply to the live
  rooms map immediately (events, checklists, automation follow without a
  restart). Companion/PP wiring still in rooms.config.js.
- **Analysis source per room** (2026-07-18): the SPL provider is now a room
  connectivity setting (`analysis`, second `room_connectivity` migration) with
  interchangeable sources: **Smaart** (existing transport) or **ProdMesh
  Remote RTA** (`github.com/jbeale/prodmesh-rta`, the free companion analyzer
  — plain WebSocket at `ws://host:8517/api/stream`, `server/integrations/rta.js`).
  `server/integrations/analysis.js` dispatches by `source`; both emit the same
  `{ ts, spl }` samples so reports/meters/analytics are source-agnostic. Edited
  on the room page (source, host/port, target/limit dB, metric, Smaart API
  password — password is write-only, redacted to `hasPassword` on reads).
  Seeding now writes a per-integration `connectivity_seeded:*` marker in
  `app_config`, after which the database is authoritative (a cleared config
  stays cleared even though rooms.config.js still declares a seed).
  **C-A ratio** (2026-07-18): RTA samples carry `ca` (C-weighted minus
  A-weighted, the bass-pressure indicator behind "too much bass" complaints)
  plus the app's configured target band (`targets.ca` in its API). Persisted
  as a nullable `ca` column on `spl_samples`; live meter shows a band gauge
  (dot on a 0–20 dB track, amber above the band), Show Report adds C-A
  avg/max (plain mean — C-A is already a difference, so no energy math).
  Smaart samples simply lack `ca` and every surface hides it.
  **Show-driven Smaart log control** (2026-07-21): Smaart only serves SPL for
  inputs that are calibrated **and actively logging** — real-time metering
  alone reads as `activeCalibratedInputs: []` (diagnosed live at FOH; starting
  logging lit the meter instantly). There is no logging RPC, but the keypress
  command handler exposes "Toggle SPL Logging" (verified on Suite 9.6.4);
  `smaart.setLogging(cfg, on)` looks the keypress up by description, checks
  real state first (the command is a toggle), fires only on mismatch, then
  polls to confirm. With `analysis.logControl` set (room-page checkbox,
  Smaart-only), show start ensures logging on and show end turns it off —
  only if the dashboard started it (flag persisted in the show file, so it
  survives a mid-show server restart). Fire-and-forget: a show never fails
  because Smaart is unreachable.
- **Code-review Tier 1 fixes** (2026-07-23, from the full architecture/tests/UI
  review): (1) connectivity saves now fire `onConnectivityChange`, and the show
  manager restarts the affected live watchers (SPL, PP timer, an active show's
  poller) — previously they held the config object captured at start, so edits
  didn't reach a running watcher until reconnect/show end; a save can also
  *start* a watcher the room couldn't run before (and begins recording SPL
  stats mid-show if analysis appears). (2) Settings panels report save results
  through one `Feedback` helper — errors are always red (several panels showed
  failures in green/muted), Schedules saves surface errors, connectivity save
  buttons disable while in flight. (3) UI polish: `.field` hover/disabled/
  placeholder + time-picker styling, keyboard focus ring on all buttons,
  `--accent-hover` token, themed color-swatch input, Analysis source uses
  SelectField. (4) `server/apiSecurity.test.js`: admin-PIN bootstrap boundary,
  login lockout (429), `shows.operate` gates, checklist mode-action permission
  matrix (nested `rooms.mode.change` + lockout override).
- **Server-owned topology** (2026-07-15, ADR 0009 milestone): the institution
  name, sites, rooms, and Quick Access tiles now live in SQLite (`sites`,
  `site_rooms`, `tiles`) and are served by `GET /api/config`; the frontend's
  static `src/config/dashboard.config.ts` is deleted (seeded verbatim into the
  database on first boot via `server/topologySeed.js`). **Admin → Campuses**
  edits the whole tree (draft + transactional whole-tree save, `config.manage`
  permission) — adding a site, room, or device tile is a browser action, no
  rebuild. The frontend is now purely an API client: every screen's topology
  comes from the server, refreshed live after a save. Room *integration*
  wiring (`rooms.config.js`) intentionally remains a dev-owned server file
  until an Admin UI takes ownership of it.
- **Storage direction:** ADR 0009 supersedes the earlier JSON-for-config split.
  Server-managed configuration and operational facts live in SQLite; only
  deployment bootstrap and restricted secrets remain outside it. Portability is
  provided by versioned JSON import/export and consistent full-database backups.

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
2. ~~Connectivity migration into the room page~~ **Complete 2026-07-21** (page
   built 2026-07-15; PC service types 2026-07-15, analysis source 2026-07-18,
   ProPresenter + Companion 2026-07-21). Pattern in `server/connectivity.js`:
   seed from rooms.config.js once (marker in `app_config`), SQLite owns it,
   applyConnectivity() assigns onto the live rooms map so consumers never
   change. ProPresenter (host/port, optional countdown-timer name; blank host
   = room has none) also made autostart eligibility per-cycle instead of
   per-boot, so connectivity edits enable/disable autostart without a restart.
   Companion is the special one: stored as one blob (host/port, state
   variable, mock, and the room's MODES — every Companion lays its buttons out
   differently, so each mode's page/row/column is per-room) and decomposed
   onto the four legacy room keys (`companion`/`state`/`mock`/`modes`).
   It can never be cleared — a room always keeps modes; "no Companion" is
   the Simulated (mock) checkbox. rooms.config.js is now entirely a
   fresh-install seed for integrations; only room identity (id/name/site)
   remains file-authoritative.
3. **PC Calendar integration** — authoritative event→room→time. Unlocks:
   auto-populating lockout windows from real bookings (retire manual schedules),
   and confidently mapping "Special Events" to the right room.
4. **Youth/Chapel go live** — get their real modes + Companion button locations,
   enter them on the room page and untick Simulated. All in the browser now.
   (Auditorium is the template.)
5. **Room-Mac browser homepages** — set each room Mac to `http://<box>:8080/room/<id>`.
6. ~~Confirm production deployment on the Producer Mac~~ **Done 2026-07-14**:
   `install-service.sh` run on Booth-Producer (launchd label `com.prodmesh.dashboard`,
   port 8080, logs in `~/prodmesh/logs/server.log`, RunAtLoad + KeepAlive). The
   Producer bridges the production LAN and the audio network, so it reaches
   Smaart directly.
7. **Later widgets on Run of Show:** YouTube Live viewers, SMAART loudness, on-air.

## Deferred tech debt (known, low-risk)

- Full browser end-to-end tests against a running server (critical component
  interactions are now covered in jsdom; live integration flows remain manual).
- PIN brute-force throttling on legacy `/api/auth/admin` (named-user login is throttled).
- Backend TypeScript (currently plain JS).
- Legacy Admin-PIN sessions reset on server restart; named-user sessions persist
  in SQLite and expire after eight hours.

## Decisions on hold pending info

- **Auditorium "Special Events"** mapping omitted until Calendar can confirm room.
- **South Campus** rooms/config — after the Dec 2026 opening.

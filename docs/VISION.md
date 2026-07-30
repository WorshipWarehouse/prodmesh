# ProdMesh — the extensible platform for Sundays

The north star for this project. [STATE.md](./STATE.md) tracks where we are;
this records where we're going and why, so any session — human or AI — starts
knowing the destination. It's a living document: edit freely.

## The problem

Churches largely run the same production stack:

**Core**
- **Planning Center Services** — service times, runs of show, volunteer coordination
- **Planning Center Calendar** — scheduling rooms to services
- **ProPresenter** — lyrics, video playback, sermon notes
- **Bitfocus Companion** — room integration glue (ATEM, lighting, screens, PA, power, routing, …)

**Common extras**
- **SMAART** — analyzing the room's average/peak loudness against parameters set
  by pastors and elders. These vary by event: our Sundays target 90 dB not to
  exceed 95 dB; our nights of worship target 95–100 dB not to exceed 105 dB.
- **Shure wireless** (e.g. Axient) — mics and IEM
- **Resi** — cross-site streaming
- **YouTube / Facebook** — public live streaming (often via a Blackmagic Web Presenter)
- **ProdCom** — real-time comms/transcription between worship backline, Music
  Director, drummer, FOH engineer, …
- **Slack** — alerts for room events (startup, shutdown, connectivity issues)

These all live in separate worlds. Nothing captures or coordinates what's
happening on Sundays, and there is no at-a-glance tool for managing it all.
And the resilience people expect from the software/cloud world is
non-existent in the production world — next to no real-time monitoring, no
preemptive alarming when things go out of bounds.

## The vision

ProdMesh is a **multi-site system — a server running at each site, one pane of
glass** — that anyone on the production team can use with minimal training to
inspect what's going on and to track and control services and the rooms
powering them.

### 1 · Room startup procedures

Begin starting a room for a specific event type **in a single click**. Every
room × event type has a checklist: some items automated (trigger a Companion
button), some manual and human-confirmed —

- install batteries in mobile cameras
- place run-of-show sheets at all tech positions
- place sermon notes in the PCR
- manually turn on specific cameras
- ensure all mic and IEM packs are charged
- start the ProTools session for live-stream broadcast audio

Checklists are configurable per room + event type, through the UI.

### 2 · Run of Show dashboard

A real-time view of the service the entire team shares, so everyone stays
aligned from start to finish.

- **Auto-track the service** — operators run ProPresenter like they always
  have; as they advance slides, ProdMesh tracks every Planning Center item in
  real time. Select a ProPresenter timer to display on the dashboard or to use
  as the service-start timer.
- **A dashboard for every role** — drag, resize, and arrange live widgets into
  custom dashboards. Everyone gets exactly the information they need — nothing
  they don't.
- **All the tools in one place** — Planning Center, ProPresenter, SMAART, Resi,
  ProdCom, livestream analytics, gear assignments, notes, and more in one
  customizable workspace.
- **Dashboards for every screen** — TVs, tablets, desktops, mobile; and
  large-format KPI layouts for a switcher multiview or stage/presenter display.
- **Live video in the dashboard** — NDI and RTMP sources as widgets.
- **Shared notes & tasks, per service (not per service time)** — shared notes,
  checklists, and task completion tracked in real time so the team stays
  aligned from rehearsal to teardown.
- **Live command center** — every service, location, and connected tool in one
  view.

### 3 · Know exactly how Sunday went

As the team runs the service, ProdMesh automatically captures timing, SPL,
livestream analytics, and every service element — a complete **Show Report**
the moment the service ends. On top of that, **reporting dashboards**: trends
in SPL, timing, and service length (partitioned by service type) over
30/60/90-day windows.

### 4 · Monitoring & resilience

Bring software-world expectations to the production world: real-time
monitoring of room systems and preemptive alerting (e.g. Slack) when something
drifts out of bounds — before it becomes a Sunday-morning surprise.

### 5 · Multi-user, multi-site

Usable in multiple locations at once without data corruption — the server is
authoritative, browsers are views (ADR 0004) — with per-user levels of access.

## Constraints

- **The tech team configures, never codes.** Rooms, checklists, schedules,
  integrations — all through the UI.
- **On-prem, LAN-first.** A box per site (Mac today, possibly Proxmox/Linux
  later). Sunday cannot depend on the internet being up.
- **Degrade gracefully.** An integration being offline never takes the
  dashboard down — mock/demo fallbacks everywhere.
- **Minimal training.** A volunteer should be able to walk up to a room page
  cold and not break anything (confirmations, lockouts, PINs for the sharp
  edges).

## Rough sequencing

Not a commitment — a default ordering to argue with.

1. **PC Calendar integration** — the authority for event→room→time. Unlocks
   auto-populated lockout windows and show autostart.
2. **Show autostart + PP timer support** — shows start themselves from the
   schedule; service-start timer from ProPresenter.
3. **SMAART capture → Show Report** — SPL average/peak per service, targets by
   event type; Timing Report grows into the Show Report.
4. **Startup checklists** (room × event type, automated + manual items).
5. **Multi-user auth & roles** (replaces the two-PIN model).
6. **Per-role customizable dashboards** (drag/resize widget layouts).
7. **Command center + South Campus** (site #2 when it opens; multi-site view).
8. **The long tail** — NDI/RTMP widgets, trends dashboards, Resi/ProdCom/
   Shure integrations, Slack alerting.

Following a live service against ProPresenter, automating start/end, and reading the after-action report.

# Run of Show

Run of Show is the live view of one service instance: where the service is in
the order of service right now, a countdown to start, loudness, and (if the
room streams) how many people are watching. It's reached by clicking a
service time on **Event Detail** (`/room/:roomId/event/:planId`), which opens
`/room/:roomId/run/:planId`.

## What a "show" is

A show is a server-side session, not a browser tab. The server — not any
browser — runs the ProPresenter poller, tracks the current item, and records
timing. At most **one show can be active per room** at a time.

This has a few consequences worth knowing:

- **Every screen agrees.** Start, End, and manual overrides are server
  actions. The moment one browser starts or ends a show, every other browser
  watching that room's Run of Show page updates immediately — there's no
  "sync" step.
- **Recording doesn't depend on a browser staying open.** If the operator's
  tab crashes or the booth Mac reboots mid-service, the show is still running
  on the server and still recording. A server restart mid-service resumes the
  show it had active, poller and all.
- **A show belongs to one room.** If someone else already started a show in
  that room (for a different plan or time), the page tells you so and links
  to the show that's actually live, instead of letting you start a second
  one.

Starting, ending, and manually overriding a show all need the
`shows.operate` permission.

## Starting a show

Open a service time from Event Detail, then **Start Show**. The server begins
polling that room's ProPresenter and starts recording timing. If ProPresenter
isn't reachable, the show still starts — it just runs in **manual mode**
(see below) instead of following slides automatically.

## Following ProPresenter live

While a show is active, Run of Show shows one of three states:

- **Following ProPresenter** — the current item highlight moves automatically
  as the operator advances slides in ProPresenter, matched by playlist order
  (with any manual mapping overrides applied — see below).
- **Manual override** — someone tapped an item in the order of service, or
  the room came up without ProPresenter live. Advance with the **Prev / Next**
  buttons, or tap any item directly. A **Resume follow** button switches back
  to tracking ProPresenter.
- **ProPresenter offline** — ProPresenter isn't reachable at all. Tracking
  falls back to fully manual.

Progress within the current item (slide N of M) shows when ProPresenter
reports a slide count for it.

## Ending a show

**End Show** stops the poller and marks the show's report complete. The page
still shows the order of service and a **Complete** badge with the time it
ended.

### Reopening a completed show

A completed show can be reopened with **Reopen show** — this un-marks it
complete and starts the show machinery again against the same plan and time.
Use this if a show was ended early by mistake, or a service resumes after a
pause.

## Rehearsals

**Start Rehearsal** runs the same show machinery — live ProPresenter
tracking, timing, loudness — but under its own synthetic time instance, not
the real service's. A rehearsal's timing and report never overwrite (or get
averaged into) the actual Sunday service's report. Run of Show marks a
rehearsal in progress with a **Rehearsal** tag next to the tracking status.

## Show Automation

Each event (not each service time) has one **Show Automation** configuration,
edited on its **Event Detail** page, in the **Show Automation** widget.
Because it's per-event, one configuration covers every service time of that
event (8:00, 9:30, 11:00, …). The widget itself is visible to anyone who can
open Event Detail; saving changes requires the `shows.configure` permission.

### Autostart and auto-complete

- **Start when PP lands on** — pick an item from the order of service. When
  the ProPresenter operator's playlist position *transitions onto* that item,
  the show starts automatically — no one needs to press Start.
- **Complete at last slide of** — pick an item. When ProPresenter reaches the
  *last slide* of that item, the show ends automatically.

Both are edge-triggered, not just "is this the active item": autostart only
fires on a transition *into* the start item (so a "Pre-Service Slides" loop
sitting there for 30 minutes between services doesn't retrigger anything),
and auto-complete only fires once the end item has been seen on an *earlier*
slide first (an item with only one slide completes immediately on entry,
since there's no earlier slide to have seen).

Autostart only watches a room during an **arm window**: from 2 hours before
the earliest configured service time to 1 hour after the latest one. Outside
that window, nothing is polled. Autostart also skips service times whose show
has already completed, so a trigger near the boundary between two services
starts the right one.

### ProPresenter mapping overrides

Normally the church's order of service maps to ProPresenter's playlist by
position — item 3 in Planning Center is playlist item 3 in ProPresenter. When
an operator reorders, adds, or removes something in ProPresenter so the
orders drift, expand **ProPresenter mapping** and override individual items:
pick which ProPresenter playlist item a given order-of-service item actually
corresponds to. Only the items that drifted need a manual entry — everything
else keeps mapping automatically by position.

If Run of Show can't find a playlist in ProPresenter matching this event (by
name), the mapping UI shows whichever playlist *is* open and warns that it
looks like a different service — push the plan from Planning Center into
ProPresenter first, or map carefully.

### YouTube broadcast pinning

If the room streams to YouTube, expand **YouTube broadcast** to see, per
service time, which broadcast its viewership numbers get attributed to.
The default, **Auto**, records whichever broadcast is live on the room's
channel at the time — correct even when the channel pre-creates one
broadcast per service (8:00 and 9:30 are different videos). Override this
only when that guess would be wrong: pin a specific broadcast, or mark a
service **Not streamed** so it doesn't record numbers from a broadcast left
running from an earlier service.

## The Show Report

Every Run of Show page links to its **Show report**
(`/room/:roomId/run/:planId/report`). It shows, once a show has recorded
anything:

- **Planned vs. Actual** — total planned length, total actual length, and the
  difference, plus a per-item table (planned length, actual length, over/under)
  with the item currently in progress marked live.
- **Loudness** — average (Leq) and peak dB against the room's target/limit,
  plus C-A ratio average/max if the analysis source reports it, when loudness
  was captured for this service.
- **YouTube viewership** — peak and average concurrent viewers, how long the
  window covers, and a sparkline of viewers over the course of the service (the
  curve depends on raw samples that eventually age out; the summary numbers
  outlive it).

Viewing the report requires the `reports.view` permission — without it, the
page still says whether the service has *finished* (so an anonymous booth
screen can tell a show is complete) but not how it went.

## The widgets

Run of Show's widget row — countdown, loudness, live viewers — is the same
component set placeable elsewhere on a dashboard; here they're pinned to the
service the page is about.

- **Countdown** shows time until the service starts. It prefers the room's
  ProPresenter "Service Start Timer" while that's running (an operator's
  Message action re-targets and starts it between services); otherwise it
  falls back to clock math against the Planning Center service time. Once the
  show is complete, it freezes into the recorded service length instead of
  counting anything.
- **Loudness** shows the live dB reading from the room's analysis source
  (Smaart or ProdMesh Remote RTA), colored by how it compares to the room's
  target/limit, plus running average and peak. Nothing renders if the room has
  no analysis source configured.
- **Live viewers** shows current YouTube concurrent viewers plus running
  peak/average. It renders nothing at all when the room isn't streamed, or
  when nothing is currently live — a "0 watching" tile on a Tuesday would just
  look like a fault.

## See also

- [Checklists](Checklists) — the per-event-type startup checklist on Event
  Detail, above Show Automation.
- [Rooms and Campuses](Rooms-and-Campuses) — configuring the ProPresenter,
  analysis, and YouTube connections a room's Run of Show depends on.

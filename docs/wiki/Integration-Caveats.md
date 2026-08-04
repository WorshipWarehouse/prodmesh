Real-world quirks in ProPresenter, Smaart, and YouTube that can look like a prodmesh bug but aren't — what you'll see, why, and what to do.

# Integration Caveats

Every quirk below was found by running prodmesh against real gear in a real
building, usually on a Sunday. None of it means prodmesh is broken. Knowing
what to expect turns "why is this doing that" into "oh, that's the thing" —
which is the whole point of this page.

## ProPresenter

### The progress bar can skip a slide, then catch up

**You'll see:** click through a few slides quickly, and the Run of Show
progress bar seems to miss one — it jumps from slide 40 to 42, say — then
corrects itself within a few seconds.

**Why:** ProPresenter streams its own slide changes to prodmesh in real
time, and under rapid advances it *coalesces* them — it doesn't announce
every single slide it passed through, only where it currently is. A slide
that was on screen for a couple hundred milliseconds may never be announced
at all. This is ProPresenter's own behavior, not something lost or dropped
by prodmesh; a raw capture of ProPresenter's stream with prodmesh entirely
out of the picture shows the identical gap.

**What to do:** nothing — this corrects itself. prodmesh polls ProPresenter
directly on a short interval specifically to catch anything the live stream
didn't announce, so the displayed state is never wrong for long, only
briefly behind. If you're single-stepping through slides at a normal pace
(rather than rapid-firing through several at once), you won't see this at
all.

### ProPresenter's port can change after a restart

**You'll see:** a room's ProPresenter connection goes from working to
unreachable after ProPresenter (or its machine) restarts, even though
nothing in prodmesh changed.

**Why:** ProPresenter assigns itself an API port, and by default that
assignment isn't guaranteed to stay the same across restarts — it's picked
per machine, not fixed by prodmesh or by ProPresenter's factory defaults.

**What to do:** in ProPresenter's own **Network** preferences, pin a
specific port for the API, then enter that same port under
**Admin → Campuses → *(the room)* → ProPresenter**. Once pinned on the
ProPresenter side, it stops moving.

### Re-triggering an item can show a stale slide position for a moment

**You'll see:** you re-trigger a presentation item you already showed
earlier in the service, and for an instant the Run of Show display reports
whatever slide that item was left on *last time* — not slide one — before
correcting itself.

**Why:** ProPresenter briefly reports the item's stored (last-used) slide
position as part of triggering it, before the actual slide change lands.
It's a real, momentary state ProPresenter itself reports, not a display bug.

**What to do:** nothing needed — it resolves itself within the same second,
as soon as the real slide change comes through. If you're building anything
that reacts to a slide position at the exact moment an item is triggered,
give it a beat before trusting the number.

## Smaart (SPL / loudness)

### A connected, metering Smaart can still show nothing

**You'll see:** the room's SPL meter shows no reading — or the show report
has no loudness curve — even though Smaart is open, connected, and visibly
showing live levels on its own meters.

**Why:** Smaart reporting to prodmesh needs *two* things to both be true,
and "Smaart is running and metering" only satisfies one of them:

1. The input Smaart is measuring must be **calibrated**.
2. Smaart's **SPL logging** must be actively **running** — not just its
   live meter display.

Live metering on Smaart's own screen works independently of both of those,
which is exactly what makes this confusing: everything *looks* fine in
Smaart while prodmesh gets nothing.

**What to do:** confirm the input is calibrated, then confirm logging is
actually started (if the room is set to start/stop logging automatically
with a show, check that the show has actually started). This is worth
checking **before** a service, not during — it's the one integration quirk
on this page that can cost you an entire service's worth of loudness data if
it's missed.

## YouTube Live

### Viewer counts only exist while the broadcast is live

**You'll see:** a show report has no viewer curve at all, for a service that
you know was streamed.

**Why:** YouTube only reports a live viewer count *while a broadcast is
actually live* — the number disappears the moment the stream ends, and
YouTube has no way to hand it back afterward. prodmesh's own recording,
taken during the service, is the only record that will ever exist. If
YouTube wasn't configured for that room yet when the service happened,
there is nothing to recover — not from YouTube, not from prodmesh, not
later.

**What to do:** if you want viewer data for a room, configure its YouTube
channel before the service you care about, not after.

### No counter at all can mean the broadcaster chose that, not an error

**You'll see:** a live-streamed service shows no viewer number the entire
time, even though the stream is clearly running.

**Why:** whoever set up the broadcast may have hidden the public viewer
counter — a normal, deliberate YouTube setting, not a connection failure.
When that's the case, prodmesh correctly shows nothing rather than a fake
zero, because a zero would misrepresent actual attendance in a report
someone might show elsewhere.

**What to do:** if you expect viewer numbers, check that broadcaster
setting in YouTube Studio. There's nothing to fix on the prodmesh side.

## Planning Center

### Planning Center doesn't know which room a service happens in

**You'll see:** a room shows service plans from a service type you didn't
expect, or none at all, even though the plan clearly exists in Planning
Center.

**Why:** Planning Center's own data model doesn't record which physical
room a service type belongs to — that mapping only exists inside prodmesh.

**What to do:** check the service type list under
**Admin → Campuses → *(the room)* → Planning Center service types**. A room
shows only the service types explicitly listed there, and a room can list
more than one if it hosts multiple kinds of services.

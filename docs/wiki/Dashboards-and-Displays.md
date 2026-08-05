Custom grids of live widgets — one you arrange and use in the booth, one you point a screen at.

# Dashboards & displays

A room can have as many of these as you want, and they come in two kinds. Both
are grids of the same widgets; what differs is who is standing in front of
them.

**Dashboards** are for a person at a desk. Six columns wide, as many rows as
you fill, with a bar across the top where you pick which event and which
service time everything on the screen is talking about. Arrange one per role —
"Front of House", "Service Producer", "Camera Shading" — so each operator sees
their own things and nothing else.

**Displays** are for a screen with nobody at it. A fixed 3×3 that fills the
whole screen with no menus, no sidebar and nothing to click: a TV in the foyer,
a stage monitor, or a Raspberry Pi wired into a video switcher's multiview.

Find them at **Room Console → Dashboards**.

## Making one

**New dashboard** or **New display**, give it a name, and you land straight in
the editor. The name also decides its address — "Front of House" lives at
`/foh` — which is shown as you type, because that address is what you will
eventually point a screen at.

Adding widgets works two ways, and both do the same thing:

- **Drag** one from the Widgets list onto the grid. A green outline shows where
  it will land; red means something is already there.
- **Press +** next to it, and it drops into the first free space that fits.

To move a widget, drag it by its title strip at the top of the card — or click
that strip, press <kbd>Enter</kbd>, and use the arrow keys. The **×** removes
it.

A few widgets can be **stretched**, and those show a small grip in their
bottom-right corner. Drag it, or hold <kbd>Shift</kbd> with the arrow keys
while the card is grabbed. Run of Show is the one that matters: it can go from
3 rows to 5, and because its order of service scrolls, the extra rows are more
of the service rather than more empty space.

Most widgets are one fixed size on purpose. A loudness meter squeezed into a
single cell and one stretched across half a screen are two different designs,
not one design scaled, so offering a handle would only ever give you the worse
version of both.

Nothing is saved until you press **Save layout**. **Discard** puts back what
was there.

### Why a widget might be greyed out

- *Already on this view* — most widgets only make sense once per screen.
- *No room left* — nothing that size fits in what's free. Displays are a hard
  3×3, so this happens there long before it happens on a dashboard.

Widgets that let you do something — Run of Show, with its Prev/Next buttons —
can only go on a dashboard. A display is meant to be looked at, not operated.

## Which service a dashboard is showing

The bar across the top is the whole answer, and it applies to every widget at
once. Change the event there and the countdown, the order of service and the
loudness meter all follow.

The chain-link button next to the event is **Follow the room**. Lit, the
dashboard tracks whatever service the room is doing next, and keeps doing so
week after week with nobody touching it — which is what you want for a screen
you set up once. Turn it off to pin the dashboard to one specific event; it
stays on whatever was already showing, so nothing jumps.

**LIVE** appears on the right whenever a show is running in that room, with the
time since it started. It is the room's show, not this dashboard's — if the
9:30 goes live while you are looking at a rehearsal layout, you still find out.

## Putting a display on a screen

1. Build the display and save it.
2. Open prodmesh **on the screen itself** and register it as a station when
   asked (name it something you will recognise — "Foyer TV", "Multiview Pi").
3. From any other machine, go to **Admin → Stations**, find that station, set
   its **Room**, and pick your display from the **Display** dropdown.

From then on that browser shows the display full-screen. Point it at the site's
address and it finds its own way there, so a machine that reboots comes back to
the right screen on its own.

Edits reach it by themselves. Rearrange the display in the booth, press Save,
and the screen changes — no walking over, no reloading, no keyboard.

!!! tip "Make it readable from across the room"
    A layout that looks right on your laptop is often unreadable as one tile of
    a video wall. Use the **Scale** control in the display's editor: 200% is
    about right for a multiview tile, more for anything further away. It
    magnifies the whole layout, so the screen still shows exactly one 3×3 —
    just bigger.

If a display ever comes up **black**, that is deliberate: it means prodmesh
could not load that layout. There is no error message because nobody is
standing there to read one, and a message left on a wall for a week stops being
seen. Check that the view still exists and that the screen can reach the
server.

## The widgets

| Widget | Size | Shows |
|---|---|---|
| Countdown | 2×1 | Time until the service starts, following the room's ProPresenter timer when one is running |
| Loudness | 2×1 | Live SPL against the room's target and limit |
| Live viewers | 1×1 | Concurrent YouTube viewers while the room is streaming |
| Run of Show | 2×3 | The order of service, what is live now, and Prev/Next/End. **Dashboards only** |
| Now & Next | 3×1 | The current item and the one after it, sized to read across a room |

A widget with nothing to say shows just its name in grey — the loudness meter
before SMAART is logging, viewers when the room is not streaming. That is not a
fault; it means there is genuinely nothing to report yet. See
[Integration caveats](Integration-Caveats.md) for why loudness in particular
often stays quiet.

## Who can change them

Arranging dashboards and displays needs the **Edit dashboards & displays**
permission. Anyone can *look* at one — including a screen with nobody logged in
at all, which is what makes an unattended display work.

The widgets that take actions keep their own rules on top of that: a Run of
Show widget will only start or advance a show for someone with **Operate
shows**, and says so plainly to anyone else rather than doing nothing when
pressed. See [Users & access](User-Management.md).

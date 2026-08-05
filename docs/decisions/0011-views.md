# 0011 — Views: stored dashboards and displays

Status: accepted (2026-08-04) · closes the "Not decided here" of
[0010](0010-topic-stream-and-widgets.md) · supersedes one claim in it (below)

## Context

0010 shipped the transport and the component contract — one topic stream per
browser, and widgets that take `{roomId, config}` and nothing else — and ended
by saying what it deliberately did not decide:

> Stored dashboard layouts: the schema, the editor, and how a layout is scoped
> to a room or campus.

This is that decision. The shape came from the maintainer's own two use cases,
which turned out to want different things from the same machinery:

- A **dashboard**: a grid in the booth, arranged per role ("Service Producer"),
  scoped to an event and service time chosen at the top of the screen.
- A **display**: a read-only screen with no keyboard — a Raspberry Pi wired
  into an ATEM multiview input, or a TV in a foyer.

## Decision

A **View** belongs to a room and has a `kind`:

| | `dashboard` | `display` |
|---|---|---|
| Grid | 6 columns, rows grow | hard 3×3 |
| Scrolls | yes | never |
| Interactive | yes | no, by construction |
| Context | Event + Service time in a menubar | follows the room on its own |
| Lives at | `/room/:roomId/view/:slug` (in the shell) | `/display/:roomId/:key` (outside it) |

One layout engine, parameterised by `(columns, maxRows)`, duplicated as
`server/gridLayout.js` and `src/lib/gridLayout.ts`. The copies are not peers:
the server validates every save, the browser's copy only draws the drop shadow,
so a disagreement is a refused save rather than corruption. Twinned test tables
are what keep them honest — the same discipline `TILE_TYPES` already uses.

"View" is the internal noun everywhere in code, the database and the API. No
screen ever shows the word; the UI says Dashboards and Displays.

### The widget contract did not change

`WidgetProps` is still `{roomId, config}`. The menubar produces `{planId,
timeId}`, which *is* `WidgetConfig` — Run of Show was already building that
exact object and handing it to every widget in its row. A dashboard is that
code with the values coming from a dropdown instead of the URL. That the
contract survived contact with the feature it was designed for is the main
evidence 0010 got it right.

### A placement is `{type, x, y, w, h, config}`

Relational rows, not a JSON blob. `show_config` uses JSON because its content
is a sparse map of opaque ids; a view's content has identity, order, and
integer geometry the server must range- and collision-check, which real columns
give `CHECK` constraints for free. One malformed row cannot take out a whole
view.

**Rows are exactly one unit tall.** They were briefly `minmax(unit, auto)` so
tall content could not clip — but then a stored `h: 3` did not mean three
units, and a widget that grew its row pushed everything below it down the
screen. A widget with more content than its authored size scrolls inside itself
(the Run of Show list does); one that needs more room is authored taller. Cells
clip, so nothing ever bleeds over its neighbour.

### Read and write disagree about unknown widget types, on purpose

- **Write refuses.** A PUT comes from this build's own editor, so an unknown
  type is a bug, and storing it stores something nothing will render.
- **Read returns it verbatim**, and the browser holds the slot with a grey
  card. Dropping the row would REFLOW the grid — every other widget shuffles up
  into the gap, rearranging a layout somebody arranged by hand, on a screen
  they are probably looking at during a service.

Same shape as the hub dropping one bad topic rather than failing a connection.

### `room_id` has no foreign key

Deliberate, and the reason belongs here because the next person will want to
"fix" it. Admin → Campuses saves the topology by DELETE-ing and reinserting
`site_rooms` — including for a pure rename — so `ON DELETE CASCADE` would wipe
every dashboard in the church the day someone corrected a typo in a campus
name. It does not today only because prodmesh never issues
`PRAGMA foreign_keys`, which also means the declared cascade on `view_id` is
documentation: `deleteView()` removes placements itself, and there is a test
asserting zero orphan rows because that failure is silent.

A view whose room is gone is orphaned, not reaped. Re-adding the room with the
same id gets its views back.

### Reads are public

An anonymous Raspberry Pi must fetch its own layout before anyone could log in.
A layout is a list of widget types and grid coordinates — strictly less than
the topology `/api/config` already serves to anyone on the LAN. Writes need the
new `views.edit` permission; there are no per-view ACLs, and widgets that act
apply their own permission at the point of action.

### One-per-view is a flag, not a rule

`unique` defaults to true. The real invariant is that a placement be
*identifiable*: today most widgets carry no config, so the type alone
identifies them and one-per-view falls out for free. The day a room has two
Smaart engines — one for the stream, one for the house — the second sets
`unique: false` and earns an identity in its config, with no schema change.

### Displays carry a scale

A 3×3 on a booth monitor is legible; the same view as one tile of a video wall
is a few hundred pixels across and type sized for a desk disappears. `scale` is
per view (a foyer TV and a multiview tile are not the same problem), chosen
from a short list rather than a free number — a slider offering 1.37 only ever
makes blurry half-pixel type. Applied as `zoom`, which scales the LAYOUT, so
the grid still fills the screen exactly with fewer CSS pixels; a transform
would render at the old size and overflow.

Unlike `columns`/`maxRows`, this one IS the client's to choose. It describes
the screen, which the server has no way to know.

### Dragging is an enhancement, not the mechanism

Every palette entry also has an Add button (find-first-fit), and every placed
card has a keyboard grab mode with arrow keys and an `aria-live` readout. That
is the complete editor — which is also why the whole thing is testable in
jsdom, where there is no layout and a simulated pointer sequence would certify
nothing. The drag gesture is verified by hand; the arithmetic under it is unit
tested, and it walks the browser's *resolved* track sizes rather than dividing
by a count.

## What this supersedes in 0010

0010 said:

> Run of Show's Start/End/Prev/Next stays a page component: no dashboard would
> place it, and giving it a config contract would be inventing a requirement to
> satisfy a pattern.

Wrong. A producer's dashboard is exactly where you want Next under your thumb,
and `run-of-show` is now a 2×3 widget. What made it safe is not the layout
system but the permission gating added the same week: a widget that acts can
offer its controls to whoever may use them and say so plainly to whoever may
not. `kinds: ['dashboard']` keeps it off a display, enforced server-side.

The page survives alongside it. It is a deep link carrying the plan (Services,
Event Detail and the report all link into it), Room-Mac homepages point at
those paths, and it owns real estate a 2×3 widget cannot have. The widget is a
placement, not a replacement — and `src/lib/showActions.tsx` is an extraction
they share, not a copy, because two copies of "hold the optimistic result until
the push arrives" would diverge invisibly until a Sunday.

## Consequences

- `defaultSpan` and `spanColumns()` are now legacy, marked as such. They answer
  a different question — width on the 12-column FLOW grid that reflows below
  880px, still used by Room Status, Event Detail and Run of Show — and the two
  vocabularies are not convertible: `third` is 4/12, `w: 2` is 2/6, and
  `two-thirds` has no clean 6-column equivalent. Both die in one commit if Run
  of Show ever renders a stored view instead of its hard-coded row.
- Below ~700px a dashboard degrades to a single column in reading order. A
  fixed 2D canvas has no honest responsive story; reflowing six columns to one
  throws the arrangement away regardless, so it becomes a priority list. Free,
  because the server normalises placements by (y, x) before storing them.
- **`MAX_TOPICS = 64` is not the ceiling to worry about.** Views are
  room-scoped, a room has five topics, and `useTopic` refcounts across mounts —
  a thirty-widget dashboard subscribes to five. What will bite when views go
  cross-room is `streamHub.js`'s `if (mine.size >= MAX_TOPICS) break;`, which
  drops every topic past the cap **with no signal to the client**: a widget
  simply never receives data and looks broken. That needs to become a visible
  refusal frame before cross-room views, not after.

## Not decided here

Cross-room and cross-campus views — the "command centre". `WidgetProps` already
carries `roomId` per widget, so the component contract is ready; what is not
decided is how a layout addresses rooms, and the hub limit above would need
revisiting first.

Per-placement configuration (pinning one widget to a different service than the
rest of its dashboard). The column exists and is validated; nothing writes it,
and the menubar is deliberately the single source of "which service" until
there is a reason for it not to be.

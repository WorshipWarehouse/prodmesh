Startup checklists tied to Planning Center event types, with items that can press a real Companion button.

# Checklists

Every event on **Event Detail** shows a startup checklist — batteries in the
mobile cameras, run-of-show sheets at tech positions, that kind of thing.
Checking an item is shared: whoever checks it off, everyone looking at that
event sees it checked.

## Templates are per event type, not per room

A checklist template belongs to a **Planning Center event type** (a service
type, like "Sunday" or "Youth Service") — not to a room. One template covers
that event type in *every room it runs in*.

This is the right model because the checklist items that matter are about the
event, not the building: "batteries in the mobile cameras" applies whether
Sunday service is running in the Main Auditorium or the Chapel this week. The
room only supplies execution context — see [automated items](#automated-items),
below, where an item presses *that room's* Companion button. There's no need
to maintain N near-identical checklists, one per room, that all say the same
thing.

There's one fallback template, the **default** (`*`), used by any event type
that doesn't have its own. A church can run entirely on the default template,
or give specific event types their own.

## Editing templates

**Admin → Checklists** lists every known event type (drawn from what's
mapped to a room's Planning Center connectivity) plus **Default**. Pick one to
edit its items:

- Reorder items with the up/down arrows.
- Each item has a label (what needs to happen) and, optionally, an action —
  see below.
- An event type with no template of its own shows *"uses the Default
  template"*; **Customize for this event type** clones the Default template as
  a starting point. **Remove (use Default)** reverts it back to following
  Default rather than deleting anything meaningful.
- A template can hold at most 50 items.

Editing templates requires the `checklists.templates.edit` permission.
Checking items off during a service requires `checklists.complete`.

## Run state is shared, not per browser

Which items are checked (and when) is stored per **event** — keyed by room
and Planning Center plan — in the database, not in any one browser's local
state. Every service time of that event shares the same checklist run. Open
Event Detail from two different tablets and they show the same checked items,
live.

## Automated items

An item can carry an action instead of being purely manual: **"Set room to
[mode]"**. Checking that item doesn't just mark it done — it presses the
room's actual Companion button for that mode first, and only marks the item
checked if that succeeds. If Companion is unreachable or the room is locked,
the item stays unchecked and the checklist shows an error instead.

Because it presses a real button, an automated item still respects that
room's **schedule-based lockouts** the same way the Room Status mode buttons
do — a checklist can't be used to sidestep a protected window. Checking it
during a locked window needs the room's override PIN just like changing mode
by hand would. It also requires the `rooms.mode.change` permission in
addition to `checklists.complete`.

When building a template in Admin → Checklists, the mode picker for an
automated item lists the union of every mode id used by any room — so a
template can name a mode a given room doesn't have. In that room, the item
just won't correspond to anything meaningful; keep automated items to modes
that are common across the rooms an event type actually runs in.

## See also

- [Run of Show](Run-of-Show) — the rest of the Event Detail page: Show
  Automation and the live service tracker the checklist sits above.
- [Rooms and Campuses](Rooms-and-Campuses) — how a room's modes and Companion
  connection (and its schedule lockouts) are configured.

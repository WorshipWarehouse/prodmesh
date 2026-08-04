How prodmesh identifies browsers and people: stations, users, permission groups, and the PINs that bootstrap access.

# User Management

## Stations vs. users

prodmesh separates two ideas that look similar but aren't: **which screen** an
action came from, and **who** performed it.

- A **station** is a browser, registered once. It has a name (e.g. "FOH –
  Producer") and, optionally, a home campus and room. Its token proves *which
  screen this is* — nothing more. Registering a station requires no
  credentials and grants no permissions.
- A **user** is a person, with a username and PIN. Logging in at a station
  proves *who is standing there right now*.

Every room dashboard opens read-only the moment its station is registered —
no login required. That's deliberate: a booth screen has to be useful showing
live status even when nobody is signed in. Changing something (a room mode,
a checklist item, show control) prompts for a login at that moment, without
hiding the operational view behind it.

Clearing a browser's storage (or opening the dashboard in a new browser)
creates a new station on next load. An administrator can rename it, assign it
to a campus/room, or revoke it later — see **Admin → Stations** below.

## Users, groups, and permissions

Access is granted through **permission groups**, not directly to users. A
user's effective permissions are the union of every group they belong to.

Permissions are stable dotted identifiers:

| Permission | What it allows |
|---|---|
| `checklists.complete` | Check or reopen startup checklist items |
| `checklists.templates.edit` | Create and change checklist templates |
| `rooms.mode.change` | Change a room's active production mode |
| `rooms.mode.override_lock` | Bypass a scheduled room-mode lockout |
| `shows.operate` | Start, end, and manually follow a show |
| `shows.configure` | Edit ProPresenter mappings and show automation |
| `history.delete` | Remove a recorded show (and its timing/loudness data) |
| `reports.view` | View completed show reports and analytics |
| `settings.manage` | Edit operational settings and schedules |
| `users.manage` | Create users and assign permission groups |
| `stations.manage` | Rename, assign, and revoke registered stations |
| `system.update` | Run a prodmesh system update |
| `system.logs` | Read the server log and the audit trail |
| `config.manage` | Edit the institution name, campuses, and Quick Access tiles |

The built-in **Administrators** group always holds every permission,
including ones added in a later release — it's a wildcard, not a checklist,
so it can't be trimmed down through ordinary group editing. Give it only to
people who should have unconditional access to everything.

Create additional groups scoped to a role — for example a "Camera Op" group
with only `checklists.complete`, or a "Producer" group with
`shows.operate` and `rooms.mode.change` but not `users.manage`. A person can
belong to more than one group at once.

One more guardrail: nobody can hand out a permission they don't personally
hold, and nobody (other than a full Administrator) can change their own
group membership. This keeps `users.manage` from being a one-click path to
granting yourself everything.

### Admin → Users & access

Create users and groups, and edit an existing user's group membership,
from **Admin → Users & access**.

Creating a user needs a display name, a username, and a PIN of at least four
characters. Linking a Planning Center person (see below) is optional.

## Linking a user to Planning Center

A user account can optionally be linked to a Planning Center person, so their
photo shows up next to their name when they're signed in. This link is purely
cosmetic — Planning Center never grants prodmesh permissions, and the two
systems' access models are entirely separate.

The picker searches **Planning Center Services** people — the serving team —
never the People product, which holds the whole congregation (addresses,
birthdays, households). Results carry only an id, a name, and a photo; nothing
else about the person crosses over. Someone who has stopped serving is still
findable (flagged inactive) rather than hidden, since they may still need a
login.

If Planning Center isn't connected, the field falls back to a plain numeric
ID — the number at the end of a person's profile URL. Typing an ID by hand
still works even with a token connected; it's the only path when a name is
spelled unexpectedly or the search is briefly unavailable.

**One person, one login.** A Planning Center person can be linked to only one
prodmesh user. Linking someone already taken is refused outright, with a
message naming the account that has them — so you find out immediately rather
than ending up with two identities for the same human.

## Admin → Stations

Every registered browser appears here, whether or not anyone has ever logged
in at it. For each station you can:

- **Rename it** — station names are just labels; renaming doesn't affect
  what the station can do.
- **Assign a campus and room** — this is what the station opens to by
  default and what a "Room only when locked" restriction applies to.
- **Restrict it to its room** — with "Room only when locked" checked, the
  station only browses its assigned room while nobody is logged in. Signing
  in unlocks the rest of the app as normal; this only shapes the read-only
  view.
- **Revoke it** — deletes the station and signs out any session currently
  open at it. That browser returns to first-run station registration the
  next time it loads the app; nothing about its history or assignment
  survives the revoke.

## PINs

Two PINs live outside the users-and-groups system, under **Admin → General →
Security**:

- **Admin PIN** — the original, legacy credential from before named users and
  permission groups existed. It still works as a bootstrap: on an install with
  no users yet, it's the only way in, and logging in with it acts as an
  Administrator with every permission (short-circuiting the ACL checks
  entirely). Keep it, but treat named users and groups as the normal way to
  grant access once they're set up.
- **Override PIN** — unrelated to login. It exists to bypass a scheduled room
  mode *lockout* (see [Rooms and Campuses](Rooms-and-Campuses)) — someone
  standing at a booth during a protected window who genuinely needs to change
  the mode. Clearing it (leaving it unset) simply means mode locks can't be
  overridden by PIN at all.

The Admin PIN must be at least six characters; the Override PIN at least four.
The difference in floor is deliberate — the Admin PIN unlocks a token that
bypasses every permission check, the Override PIN only clears a single locked
mode change for someone already on-site.

## Audit trail

Every permission check, granted or denied, and every login attempt is logged
with the user (or station, if nobody's signed in), the action, and the
result. Someone with `system.logs` can review it under **Admin → Logs**.

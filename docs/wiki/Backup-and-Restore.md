Take a copy of your whole setup, and put it back on a new machine.

# Backup & restore

One file holds everything you configured: campuses and rooms, your
integrations, users and permissions, dashboards and displays, checklists,
schedules, your logo and your PINs. Enough to stand the whole thing back up on
a different machine without setting it up again.

## Taking a backup

**Admin → General → System → Download backup.**

It saves as `prodmesh-backup-YYYY-MM-DD.pmbak`. It is usually a few tens of
kilobytes, so there is no reason not to take one after any change you would
hate to redo.

!!! warning "This file is as sensitive as the server itself"
    It contains your Planning Center token, your admin and override PINs, and
    every other credential. Anyone who has it has what prodmesh has. Keep it
    where you keep passwords, not in a shared drive or an email thread.

    Downloading one is recorded in the audit trail, and needs the **Download
    backups** permission.

### Show history

There is a tickbox for **include show history** — every recorded service, its
timing report and its loudness readings.

Leave it off unless you are moving to new hardware and want the archive to come
with you. History is almost the entire size of a backup and almost none of its
value: on a real installation the configuration was about 14 KB and the history
was 16 MB, nearly all of it loudness samples taken once a second. A backup you
take often and casually is worth more than a complete one you never take.

## Restoring

Restore happens on the **welcome screen of a fresh install**, not from inside
a running one.

1. Install prodmesh on the new machine and open it.
2. On the welcome screen, choose **Restore from a backup** and pick the file.
3. Restart prodmesh when it tells you to.

That is the whole flow. After the restart everything is as it was — same PINs,
same users, same dashboards — and you never see the setup steps.

!!! info "Why restoring is only offered on a fresh install"
    A backup sets the admin PIN and every credential. On a machine nobody has
    claimed yet that is harmless: whoever reaches it first is going to set the
    PIN anyway. On a machine that is already running your church, the same
    action would let anyone who can reach it replace your entire configuration
    and lock you out.

    So prodmesh refuses to restore once an admin PIN exists, and there is no
    button for it anywhere in the running app. If you need to restore onto a
    machine that is already set up, clear its data directory first — which is
    a deliberate, physical act rather than a click.

## When it will not restore

| What it says | What to do |
|---|---|
| "This prodmesh is already set up" | Restore only works on a fresh install. Clear the data directory, or use a new machine. |
| "This backup came from a newer prodmesh" | Update prodmesh on this machine first, then restore. Backups move forward, never back. |
| "That file is not a prodmesh backup, or it is damaged" | Check you picked the `.pmbak` file, and that it copied completely. |

## What a backup does not contain

- **Shows that were running when you took it.** A service that was live is not
  resurrected on the new machine — it is over.
- **Logged-in sessions.** People sign in again on the new machine. Their
  accounts, PINs and permissions all come back.
- **Show history**, unless you ticked the box.

## A note on where it runs

Restoring replaces the database underneath a running server, so prodmesh always
needs a restart to finish — it tells you the right way to do that for how you
installed it. It does not try to reload itself, because a half-restored server
that looks fine is worse than a clear instruction.

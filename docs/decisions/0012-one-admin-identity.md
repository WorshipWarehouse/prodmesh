# 0012 — The admin PIN is an account

Status: accepted (2026-09-01) · supersedes the admin-token half of
[0008](0008-stations-users-and-acls.md)

## Context

There were two ways to be authorized, and they had nothing to do with each
other.

**The admin PIN.** `POST /api/auth/admin` took a PIN and no username, minted a
token from a `Map` in `settings.js`, and set `req.legacyAdmin` — a flag that
every permission check consulted first:

```js
if (req.legacyAdmin || auth.hasPermission(req.auth, permission)) return next();
```

**A user.** `POST /api/auth/login` took a username and a PIN, wrote a row to
`user_sessions`, and produced permissions from group membership.

0008 introduced the second while the first was load-bearing, and left them side
by side. Four things followed, none of them intended:

1. **Admin actions had no author.** Audit rows carry `user_id`, and the admin
   token had no user, so the log recorded a station and a blank name. "Who ran
   the update" had no answer — for the one class of action where the question
   matters most.
2. **The credential everybody knows could not be typed into the login box.**
   `admin` was not a user, so the obvious thing failed. The maintainer hit this
   and reported it as an inconsistency, which is what prompted this ADR.
   `/api/auth/status` was already papering over it: for a legacy token it
   returned a fabricated `{ id: 'legacy-admin', username: 'admin',
   displayName: 'System Administrator' }`, an account that did not exist.
3. **A bypass is not a permission.** `req.legacyAdmin` short-circuited the
   check rather than satisfying it, so every new gate had to remember to
   consult it, and one that forgot would silently refuse the administrator.
   Seven call sites had grown the `req.legacyAdmin ||` prefix by hand.
4. **Admin sessions died at every restart**, being process-local — during a
   service, on a box whose Update button restarts it.

## Decision

The admin PIN is the PIN of a real account: `admin`, "System Administrator", in
the built-in Administrators group, which already resolves to `['*']`.

- **`settings.json` stays the source of that credential.** It is what an
  administrator edits on the server when the PIN is forgotten, and the restore
  seal covers it. The account is a **projection** of it —
  `authStore.projectAdminAccount(hash)` copies the stored hash across
  verbatim, at boot and on every PIN change.
- **The hash moves, not the PIN.** Both sides have always hashed identically:
  scrypt, 16-byte salt, 32-byte derived key, `salt:hash` in hex. That is the
  whole reason an existing install upgrades in silence rather than through a
  reset — verified in `adminAccountUpgrade.test.js`, which boots an install
  that has only a PIN and asserts the account arrives with it.
- **`req.legacyAdmin` is deleted.** Both doors now produce an ordinary session,
  so `hasPermission` is the only question anything asks.
- **Both doors stay.** `/api/auth/admin` (PIN only, no username, no station) is
  the way back into a box in a building, and the login form now accepts
  `admin` + the same PIN. They authenticate the same account.

Two invariants protect the way back in:

- **The built-in admin cannot be stripped of its group.** `updateUserGroups`
  refuses it. A screen that can remove that authority is a screen that can lock
  a church out of its own booth on a Sunday.
- **A credential that moves takes its sessions with it.** Rotating the PIN
  drops that account's sessions; clearing it deactivates the account rather
  than deleting it, since the audit history points at it. Rotation is what
  somebody does when they think the PIN leaked, and leaving the old session
  alive for the rest of its eight hours answers the wrong question.

## Consequences

- The audit log names an administrator. This is the change that makes
  `system.update`, `secrets` and `users.manage` attributable.
- An administrator stays signed in across a restart, because the session is a
  row rather than a `Map` entry.
- An administrator who changes their own PIN is signed out, which is what every
  password change does and is worth the surprise.
- `settings.verifyAdmin`, `createSession`, `checkSession` and `destroySession`
  are gone. `settings.adminPinHash()` and `onAdminPinChange()` replace them —
  a hook rather than an import, because settings are a FILE and users are a
  DATABASE, and the module about the first should not have to know the second
  exists. `server/index.js` is where the two are wired together.
- The wizard is unchanged: step one still asks for an admin PIN, and the
  account appears behind it.
- **Rollback is safe in one direction only.** `settings.json` keeps the hash,
  so an older build still works — but a PIN *changed* after this ships is
  written to the account and the file both, while a PIN changed by an older
  build afterwards would be seen at the next boot and re-projected. Downgrade,
  change the PIN, upgrade: the file wins, which is the behaviour to want.

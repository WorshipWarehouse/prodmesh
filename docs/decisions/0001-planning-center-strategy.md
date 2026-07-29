# ADR 0001 — Planning Center integration strategy

Status: accepted · 2026-07-01

## Context

The dashboard integrates with Planning Center (PCO). Two questions came up:
which HTTP client to use, and how far the PCO integration will grow.

## Decision 1 — hand-rolled REST client, not `@planningcenter/api-client`

We call the PCO REST API directly from `server/integrations/planningCenter.js`
rather than depending on the official `@planningcenter/api-client` package.

Reasoning (as of v3.1.0, checked 2026-07-01):
- PCO's REST API is **versioned** (dated versions), so existing calls are
  contractually stable — the "free updates" benefit of the client mostly
  applies to *new* features, not keeping current calls working.
- The client only replaces our raw `fetch`; it does **not** provide the parts
  that carry the value here — normalize + cache + mock-fallback + tests.
- Package caveats: `license: UNLICENSED`, no TypeScript types, CJS (we're ESM),
  ~80 downloads/week (low adoption), extra deps (lodash/urijs/pluralize).

Reversible for free: everything lives behind `planningCenter.js`, so the client
could later become the transport inside that module with no other changes.

**Revisit if:** we expand across many PCO products (People/Giving/Check-ins),
where broad endpoint coverage would save real boilerplate — and after the
`UNLICENSED` question is resolved via their GitHub LICENSE.

## Decision 2 — scope: Services (done) + Calendar (planned). Different roles.

- **Services** answers "what happens *in* the service" — plans, order of
  service, songs, team. This is what the current plan-display integration uses.
- **Calendar** answers "what/when/**where**" — it is the authoritative
  **event → room → time** source (rooms are *resources* / bookings in Calendar).
  Services generally does not know the physical room.

Planned use of Calendar (pending read-only API access):
- Feed **room lockout windows** from real bookings, replacing the manually
  entered schedules in the Settings UI. The lock engine already reads windows
  through `computeProtection`, so a Calendar-derived source drops in without
  touching enforcement.
- Potentially show **expected mode** (from the booking) vs **actual mode**
  (from Companion) on the Room Status page.

Expected ceiling is **two PCO products** (Services + Calendar), which is part of
why Decision 1 holds.

The user-import person search (2026-07-29) stays inside that ceiling on purpose.
People would search better — it is the product built for it — but it holds the
whole congregation, and the search only ever needs the team that serves, which
Services already has. Adding People would mean the church's PAT could reach
congregant addresses and households for a feature that never needs them.

## Consequences

- New integrations follow the `auth → fetch → normalize → cache` module pattern
  with a mock-first fallback (see `planningCenter.js`).
- Secrets live in git-ignored `server/data/secrets.json` (`getSecret(...)`).

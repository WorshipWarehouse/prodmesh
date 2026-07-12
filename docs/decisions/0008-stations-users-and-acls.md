# ADR 0008 — Stations, users, and extensible ACLs

## Status

Accepted for the user-management foundation.

## Context

Prodmesh runs primarily on a trusted production LAN, but is reachable through
an internet gateway and VPN. Room dashboards must remain immediately useful on
shared booth computers, while consequential actions increasingly need named
authorization and an audit trail.

## Decision

Treat station identity and user identity as separate concepts:

- A **station** is registered once per browser installation and identifies
  where an action originated. Its random token grants no permissions.
- A **user** authenticates temporarily at a station. Users belong to one or
  more permission groups and receive the union of their groups' ACLs.
- Permission identifiers are stable dotted strings (`checklists.complete`,
  `rooms.mode.change`, etc.) seeded by the application.
- The built-in Administrators group resolves to wildcard access and cannot be
  reduced through ordinary ACL assignment.
- Anonymous stations retain read access. Server middleware enforces write
  permissions; browser visibility is never the security boundary.
- Audit entries record user, station, action, resource context, result, and a
  deliberately small JSON details object.
- An optional Planning Center person ID links a prodmesh user to assignments,
  but Planning Center never grants prodmesh permissions.

The existing Admin PIN remains as a bootstrap credential during migration.
Named-user PINs use salted scrypt hashes; bearer tokens are stored hashed in
SQLite. Failed named-user logins are rate-limited per station and username.

## Consequences

Shared room browsers open directly in read-only mode after one-time station
registration. Protected actions can request contextual login without hiding
operational status. SQLite becomes the authoritative store for identity,
sessions, ACL membership, and audit facts. Clearing browser storage creates a
new station identity unless an administrator reconciles it later.

# ADR 0009 — Server-owned configuration in SQLite; portable JSON backups

Status: accepted · 2026-07-12

## Context

ADR 0006 split storage by control plane versus data plane: configuration in
human-editable JSON files and facts/events in SQLite. That was appropriate
while configuration was small and maintained by developers. Prodmesh is now
moving toward an installable product whose institution name, branding,
campuses, rooms, integrations, checklists, users, and permissions are managed
through the application.

Runtime JSON is a poor authoritative store for that model. Related changes
cannot be committed transactionally, concurrent edits are awkward, migrations
are ad hoc, and auditing who changed what is difficult. Keeping JSON solely to
make backup easy would optimize the live data model for an offline operation.

## Decision

The server is the source of truth for all runtime state. Storage is divided by
ownership and lifecycle rather than by control plane versus data plane.

### SQLite

SQLite stores both application-managed configuration and operational facts:

- institution identity and branding;
- campuses, rooms, and enabled integrations;
- checklist templates and show automation configuration;
- stations, users, groups, permissions, and audit records;
- show reports, measurements, and other operational history.

Configuration changes use transactions, schema validation, database migrations,
and audit records. Browsers consume configuration through the server API and do
not carry an independent authoritative configuration model.

### Bootstrap configuration

Files or environment variables are limited to settings required before the
database can be opened: database path, listen address/port, deployment identity,
and recovery/bootstrap controls. These are deployment concerns, not ordinary
Admin settings.

### Secrets

API credentials, integration passwords, and other recoverable secrets remain in
a dedicated secrets store with restricted filesystem access. Password and PIN
verifiers may live in SQLite because they are one-way hashes. Ordinary
configuration exports never include plaintext secrets.

### Backup and portability

Prodmesh provides explicit backup and restore operations instead of treating
live JSON files as the backup mechanism:

- a versioned, human-readable JSON export for portable configuration;
- validated import with a change preview before applying it;
- a consistent SQLite snapshot for full-system backup;
- optional encrypted inclusion of recoverable secrets;
- automated rolling local snapshots.

Exports distinguish configuration-only, configuration plus identity, and full
system backup so operational history need not move with an installation.

## Consequences

- Admin-managed configuration gains transactions, relationships, migrations,
  concurrent safety, and auditability.
- A fresh installation can be configured by importing a vendor-neutral JSON
  bundle without making JSON the live database.
- Backup/restore becomes an application feature that must be tested, including
  schema-version compatibility and rollback on invalid imports.
- Existing runtime JSON configuration will migrate incrementally into versioned
  SQLite tables. Read compatibility may be retained during migration, but new
  Admin-managed configuration should not add another JSON store.
- Static frontend configuration is transitional. Institution and topology data
  will ultimately be served by the backend from the authoritative model.

# ADR 0006 — SQLite for facts & events; JSON files stay for config

Status: accepted · 2026-07-02

## Context

The file stores (settings, timelines, shows) are safe because the server is
the single writer (ADR 0004) and writes are atomic (temp + rename). But SPL
capture breaks the model: ~1 sample/second for a 75-minute service is ~4,500
rows per room per service, and the vision calls for 30/60/90-day trend
queries partitioned by service type. Rewrite-the-JSON-per-sample is wrong for
that shape, and aggregating across hundreds of JSON files is misery.

## Decision

Split storage by data character:

- **Config stays in JSON files** — settings, schedules, room config, future
  checklists. Low write rate, human-inspectable on the box when something is
  weird at 7am Sunday.
- **Facts/events go to SQLite** (`server/data/prodmesh.db`, better-sqlite3,
  WAL mode) — starting with `spl_samples`, and future homes for show
  reports, notes/tasks, and trend rollups. Still just a file on the LAN box:
  zero ops, backup = copy the file, no server to babysit. Synchronous API
  matches the single-writer event-loop model.

SPL samples are keyed by the same `instanceId` (`planId__timeId`) as the
timing timelines, so the Show Report joins loudness and timing per service.

## Consequences

- 1 Hz inserts and 90-day aggregations are trivial for SQLite; no write
  amplification.
- Loudness math is done properly: averages are energy averages (Leq),
  10·log10(mean(10^(L/10))) — a loud minute counts like a loud minute.
- The Smaart integration is mock-first (ADR 0002 pattern): the JSON-over-
  WebSocket envelope is verified from Bitfocus's open-source modules, but
  the meter-read command is only in Rational's request-only SDK doc — the
  live transport lands after on-site verification. The capture pipeline is
  identical either way.
- Timelines stay JSON for now (they're small); migrating them into SQLite is
  an option when trend reports need to query them.

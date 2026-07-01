# ADR 0002 — Backend proxy + mock-first everywhere

Status: accepted · 2026-06-30

## Context

The dashboard needs to (a) read live room state from Bitfocus Companion and (b)
control it, from browsers on the LAN. Two forces shaped the design:

- **Companion's HTTP API sends no CORS headers.** A browser served from our origin
  can *fire* a request to Companion (`no-cors`) but **cannot read** the response —
  so it can't reliably read the room-state variable, which is the whole point of
  the Status screen.
- The system must be **demoable and resilient** before/without external wiring
  (Companion installs, Planning Center tokens, real IPs on the network).

## Decision

1. **Run a small backend proxy** (Express) on the always-on box. The browser talks
   only to our `/api`; the server talks to Companion and Planning Center
   server-to-server (no CORS problem). The same server serves the built SPA, so
   production is a single process on one machine.

2. **Mock-first for every external dependency.** Companion rooms carry `mock: true`
   and fall back to in-memory state; integrations return realistic sample data with
   no credentials. Reads that fail (unreachable Companion) degrade to mock with an
   `online:false` badge rather than blanking the UI.

## Consequences

- Only **one server** to run/update; room Macs are pure browsers.
- State is **polled** (~4s) rather than pushed — acceptable, and there is no
  documented Companion variable-change websocket to subscribe to anyway. A future
  push path would be Companion *triggers* POSTing to our webhook, not us
  subscribing (per-variable, not a firehose).
- The proxy is the natural home for all future integrations and caching.
- Deployment gains a Node process (vs pure static hosting) — handled by
  `deploy/install-service.sh` (launchd/systemd).

## Alternatives rejected

- **Browser → Companion directly:** can't read state (CORS). Non-starter for the
  status display.
- **Configure CORS on Companion:** not supported/undocumented; fragile.

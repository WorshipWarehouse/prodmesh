# Architecture

A modular, web-based production dashboard for the church. This doc is the mental
model — read it first when returning to the project cold. It captures *why* the
system is shaped this way, the conventions to preserve, and the gotchas learned
the hard way. For current live/mock status and the roadmap, see [STATE.md](STATE.md).

## What it is

One always-on box (a Mac in the Auditorium booth today; possibly Linux/Proxmox
later) runs a small server that:
- serves a React SPA, and
- proxies to per-room **Bitfocus Companion** installs and to **Planning Center**.

Every other screen (room Macs, booth displays) is **just a browser** pointed at
that one server. There is exactly **one server to run and update**.

```
Browser (Quick Access · Room Status · Settings)
      │  /api/*
      ▼
Express server (server/)
  ├─ proxy → Bitfocus Companion (per room, :8000)   read var / press button
  ├─ integrations/ → Planning Center (services)     auth→fetch→normalize→cache
  ├─ settings store (server/data/*.json)            PINs, lockout schedules
  └─ serves the built SPA (dist/) in production
```

## Stack

- Frontend: **React 19 + TypeScript + Vite**, **React Router**. Dark, glanceable.
- Backend: **Express 5**, plain ESM JavaScript (no build step), Node 20 (`.nvmrc`).
- Tests: **`node --test`** (backend). CI: GitHub Actions (build + test).
- No database — JSON files on disk for runtime settings.

## Layers & where things live

| Concern | Location |
|---|---|
| Quick Access tile grid (structural) | `src/config/dashboard.config.ts` |
| Tile types & rendering | `src/types.ts`, `src/tiles/registry.tsx`, `src/components/Tile.tsx` |
| Pages | `src/pages/` (QuickAccess, RoomStatus, Settings) |
| API client | `src/api.ts` |
| Room control config (structural) | `server/rooms.config.js` |
| Companion client | `server/companion.js` |
| Runtime settings (operational) | `server/settings.js` → `server/data/settings.json` |
| Lockout engine | `server/settings.js` (`computeProtection`, `isModeLocked`) |
| Integrations | `server/integrations/*.js` |
| Secrets | `server/secrets.js` → `server/data/secrets.json` |
| HTTP surface | `server/index.js` |
| Config validation | `server/validate.js` (runs at startup) |
| Deploy/update | `deploy/*.sh` |

## The patterns that keep it from sprawling

1. **Config-driven tiles + registry.** The launcher is data (`dashboard.config.ts`).
   A new tile *type* = one variant in `types.ts` + one entry in `registry.tsx`;
   everything else renders it automatically. New machine/tool = a data edit.

2. **Two config tiers.**
   - *Structural* (rooms, Companion hosts, button locations, PC service-type ids)
     lives in code (`rooms.config.js`), set up carefully and rarely. Getting it
     wrong fires the wrong AV action, so it is **not** casually UI-editable.
   - *Operational* (PINs, lockout schedules) lives in the runtime store and is
     edited via the Settings UI. Over time, more migrates tier-1 → tier-2.

3. **Integration pattern:** each external service is a self-contained module doing
   **auth → fetch → normalize → cache**, with a **mock-first** fallback. See
   `integrations/planningCenter.js` as the reference. The next integration
   (Calendar, ProPresenter) drops in the same way.

4. **Mock-first everywhere.** Companion rooms have `mock: true`; integrations fall
   back to realistic sample data with no credentials. The whole app is demoable
   with zero external wiring, and degrades gracefully when a service is down.

5. **Server-side enforcement.** Anything that must not be bypassable (admin auth,
   mode lockouts) is checked on the server. The browser is never trusted.

## Key flows

- **Room state:** RoomStatus polls `GET /api/rooms/:id/state` every 4s → server
  reads the Companion custom variable (or mock) and maps it to a mode. It mirrors
  Companion's truth regardless of who changed it (our page, a Stream Deck, a
  trigger). (No push API exists — see ADR notes / polling is deliberate.)
- **Mode change:** `POST /api/rooms/:id/mode` presses the mapped Companion button.
  If the mode is locked in a protected window, the server requires the Override
  PIN (`403 override_required` otherwise).
- **Auth:** bootstrap Admin PIN on first run → `POST /api/auth/admin` returns a
  bearer token (in-memory session) → admin endpoints check it.
- **Planning Center:** per room, upcoming plans are merged across the room's
  service types (soonest first); the next plan is hydrated with **service** times
  and its order of service.

## Invariants — do not break these

- Never trust the client for auth/lockout; enforce on the server.
- Never commit `server/data/` (PINs, secrets, per-box settings). It is git-ignored.
- Keep structural config (button locations!) in code and validated at startup.
- Integrations stay mock-first and cached; never let a slow/broken external API
  block or blank the dashboards.
- One server owns production; room Macs are browsers. Update = update that box.

## Gotchas learned (would re-bite a fresh context)

- **Companion has no CORS headers** → the browser can't read its API directly.
  Hence the proxy (ADR 0002).
- **`vnc://` screen sharing** only opens Screen Sharing.app on a **Mac** client.
- **`crypto.randomUUID()` needs a secure context** (https/localhost) — it throws
  on `http://<lan-ip>`. Use a manual id generator in the browser.
- **Planning Center plan_times mix in rehearsals/auditions/soundchecks** — we show
  `service` + `rehearsal` (rehearsals in purple), and drop the rest. Fetch times
  per-plan, not via `include` (the included array is ambiguous across plans). The
  Quick Access overview shows service times only; Room Status shows both.
- **A room hosts multiple PC service types** (the Auditorium = Sunday/Second Service/
  Midweek/Evening). Map rooms to an array and merge.
- **PC Calendar, not Services, is the authoritative event→room→time source.**
  Services doesn't reliably know the physical room. See ADR 0001.
- **launchd/systemd don't inherit your PATH** — the service installer bakes in the
  absolute `node` path.

## Testing & CI

`npm test` runs `node --test` over `server/*.test.js`: pure helpers, config
validation, the settings/lock engine, the PC integration (mock + cache), and full
API auth + lockout flows against mock-mode rooms (no Companion/PC needed). CI runs
build + test on push/PR. Frontend component tests are deferred (see STATE.md).

## Decisions

Architecture decisions are recorded in [`docs/decisions/`](decisions/). Start there
for the reasoning behind load-bearing choices.

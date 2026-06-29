# Production Dashboard

A modular, web-based launcher + dashboard for church production. Screens so far:

- **Quick Access** (`/`) — a launcher that opens on each production Mac and jumps
  the team into the right tools per site & auditorium:
  - **Room Status** tiles → open that room's Status page (mode control)
  - **Companion** tiles → open the Bitfocus Companion web UI (`http://host:8000`)
  - **Screen Share** tiles → open macOS Screen Sharing.app to a Mac (`vnc://host`)
  - **Link** tiles → device web UIs (Hyperdeck, GrandMA3, cameras…) / any web tool
- **Room Status** (`/room/<id>`) — a simple, pastor-facing screen meant to be the
  **browser homepage** on each room's main Mac. Shows the room's current mode
  (read live from a Companion variable) and one-tap buttons to switch between
  **Sunday / Mid-Week / Special Event**, plus **Standby** when the room is active.

Sites: **North** (active) and **South Campus** (opens December 2026), each
with Main / Youth / Chapel / Elementary Chapel auditoriums.

## Architecture

```
Browser (Quick Access + Room Status)
        │  /api/*
        ▼
Express proxy  (server/)  ──HTTP──▶  Bitfocus Companion  (per room, :8000)
        │
        └─ also serves the built frontend (dist/) in production
```

The proxy exists because Companion's HTTP API sends no CORS headers, so the
browser can't read room state from it directly. The server reads/writes Companion
server-side and exposes a clean `/api`.

## How it's organized

The whole UI is **config-driven**. You almost never edit components — you edit
one data file:

```
src/config/dashboard.config.ts   ← THE dashboard: sites, auditoriums, tiles
src/types.ts                     ← data model + how to add a new tile type
src/tiles/registry.tsx           ← how each tile type behaves (icon, link, color)
src/components/                  ← generic renderers (Site, Auditorium, Tile)
```

### Add a machine or tool

Open `src/config/dashboard.config.ts` and add a tile to the right auditorium:

```ts
{ id: 'north-main-graphics', type: 'screenshare',
  label: 'Graphics Mac', note: 'Screen Sharing', host: '192.0.2.40' },

{ id: 'north-main-companion', type: 'companion',
  label: 'Companion', host: '192.0.2.10' },   // → http://192.0.2.10:8000
```

> Replace every `PLACEHOLDER-*` host with a real IP or `.local` hostname.

### Add a whole new module later (metrics, service order, media status…)

1. Add a variant to the `Tile` union in `src/types.ts`.
2. Add one entry to `tileRegistry` in `src/tiles/registry.tsx`.

That's it — the rest of the app renders it automatically. This is what keeps the
project from sprawling as it grows.

## Room Status screens (mode control)

Room control lives in **`server/rooms.config.js`** — the source of truth for the
Status pages. Each room maps to a Companion install, a state variable, and a set
of modes (each mode presses a Companion button).

Set each room Mac's **browser homepage** to its Status page, e.g.
`http://<lan-box>:8080/room/north-main`.

### Going live for a room

Rooms ship with `mock: true`, so the screens work in-memory before any Companion
wiring exists (great for demos). To make a room control real Companion:

1. In Companion, create a **custom variable** (default name `room_mode`) and have
   each mode's automation set it to that mode's `match` value
   (`sunday` / `midweek` / `special` / `standby`).
2. Note the **page/row/column** of each mode's button and fill in `press`.
3. Set **`mock: false`** for that room.

The Status page shows **● Companion live** when it's reading real state, or
**○ Demo mode** when it's falling back to in-memory state.

## Run it

```bash
npm install
npm run dev      # web (http://localhost:5173) + API proxy (http://localhost:3001)
npm run build    # production build → dist/
npm start        # serve built app + API on one port (default 8080)
```

In dev, Vite proxies `/api` to the Express server automatically.

## Deploy on the always-on LAN box

```bash
npm run build
npm start        # → every PC opens http://<lan-box-ip>:8080
# (PORT=9000 npm start to change the port)
```

To survive reboots, keep `npm start` running with a process manager (`pm2`, a
`launchd` plist, etc.) and give the box a stable IP or `.local` hostname so the
URL never changes.

### Notes for the all-Mac setup

- **`vnc://` screen sharing** opens Screen Sharing.app natively on macOS. Enable
  **System Settings → General → Sharing → Screen Sharing** on each target Mac.
  The first launch may ask the browser for permission to open the app.
- **Companion** must be reachable on the LAN; its web UI defaults to port 8000.
  Set a tile's `view` to `'tablet'` or `'emulator'` to deep-link those pages.
- Kiosk tip: open the URL in Safari and **View → Enter Full Screen**, or add it
  to the Dock / login items on each booth Mac.

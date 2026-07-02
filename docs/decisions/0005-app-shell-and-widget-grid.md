# ADR 0005 — App shell + widget grid UI architecture

Status: accepted · 2026-07-02

## Context

The first five pages each hand-rolled their own header/logo/clock/back-link and
shared one 1,370-line `App.css`. Every new feature meant building another
one-off page layout, and dashboard-like pieces (service panel, mode control)
were trapped inside specific pages.

## Decision

1. **App shell** (`src/layout/AppShell.tsx`) — a React Router layout route that
   owns all chrome: sticky top bar with brand (→ home), a room switcher,
   contextual **Status | Run of Show** tabs when inside a room, clock, and the
   settings gear. Pages render inside `<Outlet />` and own zero chrome.
   - The "Run of Show" tab targets `/room/:id/show`, a tiny resolver page that
     redirects to the active show if one is running, else the next upcoming
     service, else back to Room Status — so the tab is always meaningful.
2. **Widget grid** (`src/components/Widget.tsx` — `Widget` + `WidgetGrid`) —
   dashboard pages compose self-contained cards into a 12-column grid
   (`span`: half / third / two-thirds; full width on narrow screens). Room
   Status is the first conversion: a Mode widget and the Upcoming Service
   widget. **A new feature is a new widget, not a page rewrite** (e.g. future
   YouTube Live / SMAART cards).
3. **CSS: tokens + per-feature files** (`src/styles/`) — `tokens.css` holds all
   colors/radii as custom properties; `base.css` holds shared controls
   (buttons, fields, pills, confirm dialog, page scaffolding); one stylesheet
   per feature area (shell, widgets, launcher, room, service, show, report,
   settings), imported in order by `styles/index.css`. Feature CSS references
   tokens, never hard-coded hex.

## Consequences

- Adding a screen = content only; adding a room feature = a widget.
- Navigation is persistent: switch rooms and Status ↔ Run of Show from
  anywhere, matching the "server coordinates, frontends are views" direction
  (ADR 0004) — any browser can jump to the live show via the tab.
- The visual language (dark theme, cards, chips) is unchanged; it's now
  enforced by tokens instead of repetition.
- Run of Show and Settings kept their internals this pass; converting Run of
  Show's countdown/tracker blocks to `Widget`s is a follow-up.

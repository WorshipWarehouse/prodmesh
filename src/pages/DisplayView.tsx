import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getView, type View } from '../api';
import { ViewCanvas } from '../views/ViewCanvas';
import { useQuery, invalidate } from '../lib/useQuery';
import { useTopic } from '../lib/stream';
import { viewKey } from '../lib/keys';
import { gridFor } from '../lib/gridLayout';

// ─────────────────────────────────────────────────────────────────────────────
//  A display: one view, full screen, nothing else.
//
//  Deliberately OUTSIDE AppShell — no sidebar, no nav, no account menu. This
//  is not a page someone browses; it is what a Raspberry Pi wired into an ATEM
//  input shows for months at a time. /setup is the same shape and the only
//  other route that lives out here.
//
//  It is also read-only by construction rather than by promise: the widget
//  registry refuses to put an interactive widget on a display (see
//  server/validate.js), so there is nothing here to press even if someone
//  plugged in a mouse.
// ─────────────────────────────────────────────────────────────────────────────

export function DisplayView() {
  // `key` is a slug OR an id. A station stores the id, a human types the slug,
  // and renaming a view must not blank a screen nobody can reach.
  const { roomId = '', key = '' } = useParams();

  const viewQ = useQuery(viewKey(roomId, key), () => getView(roomId, key), { staleMs: 60_000 });
  const view: View | null = viewQ.data?.view ?? null;

  // Pushed, not polled. A layout edited in the booth has to reach a screen
  // with no keyboard and nobody standing at it — and the alternative, a poll
  // fast enough to feel immediate, would be a request every few seconds from
  // every screen in the building, forever.
  const pushed = useTopic<unknown>(roomId ? `room:${roomId}:views` : null);
  useEffect(() => {
    if (pushed) invalidate(viewKey(roomId, key));
  }, [pushed, roomId, key]);

  const grid = view ? gridFor(view.kind) : null;

  // No spinner and no error card. A screen on a wall showing "Loading…" or a
  // stack trace is worse than a screen showing nothing — nobody is there to
  // read it, and it will still be there next Sunday. Black is a fault someone
  // notices; a message is one they stop seeing.
  if (!view || !grid) return <div className="display display--blank" />;

  // `zoom`, not transform: it scales the LAYOUT, so the grid still fills the
  // screen exactly and simply has fewer CSS pixels to fill it with. A
  // transform would render at the old size and then overflow the viewport.
  return (
    <div className="display" style={{ zoom: view.scale > 1 ? view.scale : undefined }}>
      <ViewCanvas view={view} grid={grid} config={{}} />
    </div>
  );
}

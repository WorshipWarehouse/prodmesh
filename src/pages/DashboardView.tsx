import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LayoutGrid } from 'lucide-react';
import { getRoom, getRoomService, getView, type RoomMeta, type View } from '../api';
import { ViewCanvas } from '../views/ViewCanvas';
import { ViewMenubar } from '../views/ViewMenubar';
import { useQuery } from '../lib/useQuery';
import { roomServiceKey, viewKey } from '../lib/keys';
import { gridFor } from '../lib/gridLayout';
import type { WidgetConfig } from '../widgets/types';

// One room's dashboard: the grid, plus the bar that says which service every
// widget on it is talking about.

export function DashboardView() {
  const { roomId = '', slug = '' } = useParams();

  // "Follow the room" until someone picks — see ViewMenubar. Session state, not
  // stored: two people looking at the same dashboard from different machines
  // are usually looking for different things.
  const [config, setConfig] = useState<WidgetConfig>({});

  const viewQ = useQuery(viewKey(roomId, slug), () => getView(roomId, slug), { staleMs: 60_000 });
  const roomQ = useQuery(`room:${roomId}`, () => getRoom(roomId), { staleMs: 10 * 60_000 });
  const serviceQ = useQuery(roomServiceKey(roomId), () => getRoomService(roomId), {
    staleMs: 5 * 60_000,
  });

  const view: View | null = viewQ.data?.view ?? null;
  const room: RoomMeta | null = roomQ.data ?? null;
  const grid = useMemo(() => (view ? gridFor(view.kind) : null), [view]);

  if (viewQ.error || roomQ.error) {
    return (
      <div className="pagemsg">
        <p>{viewQ.error ? 'Dashboard not found' : 'Room not found'}</p>
        <Link className="backlink" to={`/room/${roomId}/views`}>← All dashboards</Link>
      </div>
    );
  }
  if (!view || !grid) return <div className="pagemsg">Loading…</div>;

  return (
    <div className="viewpage">
      <div className="pagehead">
        <div>
          <Link className="backlink" to={`/room/${roomId}/views`}>← All dashboards</Link>
          <h1 className="pagehead__title">{view.name}</h1>
          <p className="pagehead__sub">{room?.name}</p>
        </div>
      </div>

      {/* A display has no menubar — it is read-only and follows the room on its
          own. Seeing one here would suggest a control the screen won't have. */}
      {view.kind === 'dashboard' && (
        <ViewMenubar plans={serviceQ.data?.plans ?? []} config={config} onChange={setConfig} />
      )}

      {view.widgets.length === 0 ? (
        <div className="viewempty">
          <LayoutGrid size={22} aria-hidden />
          <p>No widgets yet.</p>
        </div>
      ) : view.kind === 'display' ? (
        // Letterboxed to 16:9, because that is the shape it will actually be:
        // a tile on a multiview or a TV. Previewing a fixed canvas at whatever
        // height the page happens to give it would show a layout nobody will
        // ever see.
        <div className="viewframe">
          <ViewCanvas view={view} grid={grid} config={config} />
        </div>
      ) : (
        <ViewCanvas view={view} grid={grid} config={config} />
      )}
    </div>
  );
}

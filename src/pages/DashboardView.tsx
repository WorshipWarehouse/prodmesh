import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LayoutGrid, Settings2 } from 'lucide-react';
import { getRoomService, getView, getViews, type View } from '../api';
import { ViewCanvas } from '../views/ViewCanvas';
import { ViewBar } from '../views/ViewBar';
import { useQuery } from '../lib/useQuery';
import { roomServiceKey, viewKey, viewsKey } from '../lib/keys';
import { gridFor } from '../lib/gridLayout';
import { useCan } from '../lib/identity';
import type { WidgetConfig } from '../widgets/types';

// A room's dashboard: one header row, then the grid.
//
// No page header above the bar. A dashboard is a wall of information and the
// chrome is overhead — the bar carries the name (as a switcher), the context
// every widget inherits, and whether the room is live, in the space a title
// alone used to take.

export function DashboardView() {
  const { roomId = '', slug = '' } = useParams();

  // "Follow the room" until someone picks. Session state, not stored: two
  // people on the same dashboard from different machines are usually looking
  // for different things.
  const [config, setConfig] = useState<WidgetConfig>({});
  const canEdit = useCan('views.edit');

  const viewQ = useQuery(viewKey(roomId, slug), () => getView(roomId, slug), { staleMs: 60_000 });
  const viewsQ = useQuery(viewsKey(roomId), () => getViews(roomId), { staleMs: 30_000 });
  const serviceQ = useQuery(roomServiceKey(roomId), () => getRoomService(roomId), {
    staleMs: 5 * 60_000,
  });

  const view: View | null = viewQ.data?.view ?? null;
  const grid = useMemo(() => (view ? gridFor(view.kind) : null), [view]);

  // Only same-kind siblings: switching from a dashboard to a display would
  // land on a page with different chrome, which is a navigation, not a filter.
  const siblings = (viewsQ.data?.views ?? []).filter((v) => v.kind === view?.kind);

  if (viewQ.error) {
    return (
      <div className="pagemsg">
        <p>Dashboard not found</p>
        <Link className="backlink" to={`/room/${roomId}/views`}>← All dashboards</Link>
      </div>
    );
  }
  if (!view || !grid) return <div className="pagemsg">Loading…</div>;

  return (
    <div className="viewpage">
      <ViewBar
        roomId={roomId}
        view={view}
        siblings={siblings.length ? siblings : [view]}
        plans={serviceQ.data?.plans ?? []}
        config={config}
        onChange={setConfig}
        actions={
          canEdit && (
            <Link
              className="iconbtn"
              aria-label="Edit layout"
              title="Edit layout"
              to={`/room/${roomId}/view/${view.slug}/edit`}
            >
              <Settings2 size={16} />
            </Link>
          )
        }
      />

      {view.widgets.length === 0 ? (
        <div className="viewempty">
          <LayoutGrid size={22} aria-hidden />
          <p>No widgets yet.</p>
          {canEdit && (
            <Link className="btn btn--primary btn--sm" to={`/room/${roomId}/view/${view.slug}/edit`}>
              Add some
            </Link>
          )}
        </div>
      ) : view.kind === 'display' ? (
        // Letterboxed to 16:9, because that is the shape it will be on the
        // wall. Previewing a fixed canvas at whatever height the page happened
        // to give it would show a layout nobody will ever see.
        <div className="viewframe">
          <ViewCanvas view={view} grid={grid} config={config} />
        </div>
      ) : (
        <ViewCanvas view={view} grid={grid} config={config} />
      )}
    </div>
  );
}

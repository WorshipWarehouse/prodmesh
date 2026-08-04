import { Link, useParams } from 'react-router-dom';
import { LayoutGrid, Monitor } from 'lucide-react';
import { getRoom, getViews, type ViewSummary } from '../api';
import { useQuery } from '../lib/useQuery';
import { viewsKey } from '../lib/keys';

// A room's dashboards and displays.
//
// The stored object is a "view" everywhere in the code and the API; nobody
// reading this screen ever sees that word. Two kinds, two headings.

const KINDS = [
  {
    kind: 'dashboard' as const,
    title: 'Dashboards',
    icon: LayoutGrid,
    empty: 'No dashboards yet.',
  },
  {
    kind: 'display' as const,
    title: 'Displays',
    icon: Monitor,
    empty: 'No displays yet.',
  },
];

export function ViewsIndex() {
  const { roomId = '' } = useParams();

  const viewsQ = useQuery(viewsKey(roomId), () => getViews(roomId), { staleMs: 30_000 });
  const roomQ = useQuery(`room:${roomId}`, () => getRoom(roomId), { staleMs: 10 * 60_000 });

  if (viewsQ.error || roomQ.error) {
    return (
      <div className="pagemsg">
        <p>Room not found</p>
        <Link className="backlink" to="/">← Quick Access</Link>
      </div>
    );
  }
  const all = viewsQ.data?.views;
  const room = roomQ.data;
  if (!all || !room) return <div className="pagemsg">Loading…</div>;

  const byKind = (kind: ViewSummary['kind']) => all.filter((v) => v.kind === kind);

  return (
    <div className="viewsindex">
      <div className="pagehead">
        <div>
          <Link className="backlink" to={`/room/${roomId}`}>← {room.name}</Link>
          <h1 className="pagehead__title">Dashboards &amp; displays</h1>
        </div>
      </div>

      {KINDS.map(({ kind, title, icon: Icon, empty }) => {
        const list = byKind(kind);
        return (
          <section className="panel" key={kind}>
            <h2 className="panel__title">{title}</h2>
            {list.length === 0 ? (
              <p className="viewsindex__empty">{empty}</p>
            ) : (
              <ul className="viewsindex__list">
                {list.map((view) => (
                  <li key={view.id}>
                    <Link className="viewsindex__row" to={`/room/${roomId}/view/${view.slug}`}>
                      <Icon size={16} aria-hidden />
                      <span className="viewsindex__name">{view.name}</span>
                      <span className="viewsindex__meta mono">
                        {view.columns}×{view.maxRows ?? '∞'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

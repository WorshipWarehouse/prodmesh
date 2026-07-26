import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, CheckCircle2, Trash2, Volume2 } from 'lucide-react';
import { deleteHistoryShow, getHistory, type HistoryShow } from '../api';
import { inCampus, useCampus } from '../layout/campus';
import { roomLabel, useChurch } from '../layout/church';

function fmtClock(ms: number | null) {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function fmtDur(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

function DeltaChip({ delta }: { delta: number }) {
  if (Math.abs(delta) < 30) return <span className="hist__delta hist__delta--ok">on time</span>;
  const m = Math.round(Math.abs(delta) / 60);
  return (
    <span className={`hist__delta hist__delta--${delta > 0 ? 'over' : 'under'}`}>
      {m}m {delta > 0 ? 'over' : 'under'}
    </span>
  );
}

// Show-report history from SQLite + recorded timelines: every show ever run,
// newest first, linking into its full report. Trend charts come later, once
// real SPL data has accumulated (VISION: 30/60/90-day trends).
export function Analytics() {
  const { campusId } = useCampus();
  const church = useChurch();
  const [shows, setShows] = useState<HistoryShow[] | null>(null);
  const [error, setError] = useState(false);
  const [toDelete, setToDelete] = useState<HistoryShow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  useEffect(() => {
    getHistory().then((h) => setShows(h.shows)).catch(() => setError(true));
  }, []);

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleteBusy(true);
    setDeleteErr(null);
    try {
      await deleteHistoryShow(toDelete.instanceId);
      setShows((list) => (list ?? []).filter((s) => s.instanceId !== toDelete.instanceId));
      setToDelete(null);
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteBusy(false);
    }
  };

  const visible = (shows ?? []).filter((s) => inCampus(campusId, s.site));

  return (
    <div className="hist">
      <div className="pagehead">
        <div>
          <h1 className="pagehead__title">Analytics</h1>
        </div>
      </div>

      {error && <p className="pagemsg">Couldn’t load history.</p>}
      {shows !== null && visible.length === 0 && (
        <div className="hist__empty">
          <BarChart3 size={28} />
          <p>No shows recorded yet{campusId !== 'all' ? ' for this campus' : ''}.</p>
          <p className="svc__muted">
            Run a show from an event’s Run of Show page and it will appear here with its timing
            report and loudness stats.
          </p>
        </div>
      )}

      {visible.length > 0 && (
        <div className="hist__table" role="table">
          <div className="hist__row hist__row--head" role="row">
            <span>Service</span>
            <span>Room</span>
            <span>Runtime</span>
            <span>Loudness</span>
            <span />
          </div>
          {visible.map((s) => {
            const label = s.planTitle ?? (s.planId ? `Plan ${s.planId}` : 'Show');
            const when = s.timeStartsAt
              ? fmtClock(new Date(s.timeStartsAt).getTime())
              : fmtClock(s.startedAt);
            const href =
              s.roomId && s.planId
                ? `/room/${s.roomId}/run/${s.planId}/report${s.timeId && s.timeId !== 'default' ? `?time=${s.timeId}` : ''}`
                : null;
            const body = (
              <>
                <span className="hist__svc">
                  <span className="hist__title">
                    {label}
                    {s.rehearsal && <span className="hist__rehearsal">Rehearsal</span>}
                    {s.completedAt && (
                      <CheckCircle2 size={13} className="hist__done" aria-label="Completed" />
                    )}
                  </span>
                  <span className="hist__when">
                    {when}
                    {s.serviceTypeName ? ` · ${s.serviceTypeName}` : ''}
                    {s.timeName ? ` · ${s.timeName}` : ''}
                  </span>
                </span>
                <span className="hist__room">
                  {s.roomName ? roomLabel(s.roomName, s.site, church, campusId) : '—'}
                </span>
                <span className="hist__runtime">
                  {s.totals.actual > 0 ? (
                    <>
                      {fmtDur(s.totals.actual)}
                      {s.totals.planned > 0 && <DeltaChip delta={s.totals.delta} />}
                    </>
                  ) : (
                    <span className="svc__muted">not tracked</span>
                  )}
                </span>
                <span className="hist__spl">
                  {s.spl ? (
                    <>
                      <Volume2 size={13} /> {s.spl.leq?.toFixed(1)} <small>avg</small> ·{' '}
                      {s.spl.peak?.toFixed(1)} <small>peak</small>
                    </>
                  ) : (
                    <span className="svc__muted">—</span>
                  )}
                </span>
                <span className="hist__go">
                  <button
                    type="button"
                    className="hist__delete"
                    title="Delete this recorded run"
                    aria-label={`Delete ${label}`}
                    onClick={(e) => {
                      e.preventDefault(); // the row is a link into the report
                      e.stopPropagation();
                      setDeleteErr(null);
                      setToDelete(s);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                  {href ? '→' : ''}
                </span>
              </>
            );
            return href ? (
              <Link key={s.instanceId} to={href} className="hist__row" role="row">
                {body}
              </Link>
            ) : (
              <div key={s.instanceId} className="hist__row" role="row">
                {body}
              </div>
            );
          })}
        </div>
      )}

      {toDelete && (
        <div className="confirm" role="dialog" aria-modal="true">
          <div className="confirm__card">
            <p className="confirm__text">
              Delete <strong>{toDelete.planTitle ?? 'this run'}</strong>
              {toDelete.rehearsal ? ' (rehearsal)' : ''}? Its show report and loudness data are
              erased permanently.
            </p>
            {deleteErr && <p className="confirm__error">{deleteErr}</p>}
            <div className="confirm__buttons">
              <button type="button" className="confirm__cancel" onClick={() => setToDelete(null)} disabled={deleteBusy}>
                Cancel
              </button>
              <button type="button" className="confirm__ok confirm__ok--danger" onClick={confirmDelete} disabled={deleteBusy}>
                {deleteBusy ? 'Deleting…' : 'Delete run'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

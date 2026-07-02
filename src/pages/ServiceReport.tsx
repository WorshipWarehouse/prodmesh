import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getReport, getRoomPlan, type ServicePlan, type TimingReport } from '../api';

function mmss(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function signed(sec: number) {
  const sign = sec > 0 ? '+' : sec < 0 ? '−' : '';
  return `${sign}${mmss(Math.abs(sec))}`;
}

export function ServiceReport() {
  const { roomId = '', planId = '' } = useParams();
  const [params] = useSearchParams();
  const timeId = params.get('time');
  const [report, setReport] = useState<TimingReport | null>(null);
  const [plan, setPlan] = useState<ServicePlan | null>(null);

  useEffect(() => {
    getRoomPlan(roomId, planId).then((r) => setPlan(r.plan)).catch(() => {});
  }, [roomId, planId]);

  const load = useCallback(() => {
    getReport(roomId, planId, timeId).then(setReport).catch(() => {});
  }, [roomId, planId, timeId]);

  // Refresh while the service is live; useful glancing at it during the debrief.
  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  const backToRun = `/room/${roomId}/run/${planId}${timeId ? `?time=${timeId}` : ''}`;

  // "Youth Service · Getting Over Yourself · July 6 · 9:30 AM" — which service
  // instance this report is for.
  const time = plan?.times.find((t) => t.id === timeId) ?? null;
  const clock = time?.startsAt
    ? new Date(time.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : time?.name ?? null;
  const serviceLine = plan
    ? [plan.serviceTypeName, plan.title, plan.dates, clock].filter(Boolean).join(' · ')
    : null;

  return (
    <div className="report">
      <div className="pagehead">
        <div>
          <Link className="backlink" to={backToRun}>← Run of Show</Link>
          <h1 className="pagehead__title">Timing Report</h1>
          {serviceLine && <p className="pagehead__sub">{serviceLine}</p>}
        </div>
        <div className="pagehead__right">
          {report?.completedAt && (
            <span className="svc__badge svc__badge--live">
              ✓ Completed{' '}
              {new Date(report.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          <button className="btn btn--sm" onClick={load}>Refresh</button>
        </div>
      </div>

      {!report || report.items.length === 0 ? (
        <p className="settings__muted">
          No timing recorded yet. It builds automatically as the Run of Show follows
          along during the service.
        </p>
      ) : (
        <>
          <div className="report__summary">
            <div className="report__stat">
              <span className="report__stat-label">Planned</span>
              <span className="report__stat-val">{mmss(report.totals.planned)}</span>
            </div>
            <div className="report__stat">
              <span className="report__stat-label">Actual</span>
              <span className="report__stat-val">{mmss(report.totals.actual)}</span>
            </div>
            <div className={`report__stat report__stat--${report.totals.delta > 0 ? 'over' : 'under'}`}>
              <span className="report__stat-label">{report.totals.delta > 0 ? 'Over' : 'Under'}</span>
              <span className="report__stat-val">{signed(report.totals.delta)}</span>
            </div>
          </div>

          <table className="report__table">
            <thead>
              <tr>
                <th>#</th>
                <th>Item</th>
                <th>Planned</th>
                <th>Actual</th>
                <th>+/−</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((it, i) => (
                <tr key={i} className={it.ongoing ? 'report__row--live' : ''}>
                  <td className="report__num">{i + 1}</td>
                  <td>
                    {it.itemName}
                    {it.ongoing && <span className="report__live">● live</span>}
                  </td>
                  <td className="report__num">{it.plannedLength ? mmss(it.plannedLength) : '—'}</td>
                  <td className="report__num">{mmss(it.actualSeconds)}</td>
                  <td className={`report__num ${it.delta == null ? '' : it.delta > 0 ? 'report__over' : 'report__under'}`}>
                    {it.delta == null ? '—' : signed(it.delta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

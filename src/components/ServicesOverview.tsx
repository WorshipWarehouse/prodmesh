import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getServicesOverview, type ServicesOverview as Overview } from '../api';

const REFRESH_MS = 5 * 60 * 1000;

function fmtTime(iso: string | null, fallback: string | null) {
  if (!iso) return fallback ?? '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? fallback ?? ''
    : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function ServicesOverview() {
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => getServicesOverview().then((d) => active && setData(d)).catch(() => {});
    load();
    const iv = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(iv);
    };
  }, []);

  if (!data || data.services.length === 0) return null;

  return (
    <section className="overview">
      <div className="overview__head">
        <h2 className="overview__title">Upcoming Services</h2>
        <span className={`svc__badge svc__badge--${data.live ? 'live' : 'mock'}`}>
          {data.live ? '● Planning Center' : '○ Sample data'}
        </span>
      </div>
      <div className="overview__grid">
        {data.services.map((s) => (
          <Link key={s.roomId} className="ovcard" to={`/room/${s.roomId}`}>
            <div className="ovcard__room">{s.roomName}</div>
            <div className="ovcard__type">{s.serviceType}</div>
            {s.next ? (
              <>
                <div className="ovcard__date">{s.next.dates}</div>
                <div className="ovcard__times">
                  {s.next.times.map((t) => (
                    <span key={t.id} className="svc__time">{fmtTime(t.startsAt, t.name)}</span>
                  ))}
                </div>
              </>
            ) : (
              <div className="svc__muted">No upcoming plans</div>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}

import { useEffect, useState } from 'react';
import { getRoomService, type RoomService } from '../api';

const REFRESH_MS = 5 * 60 * 1000;

function fmtTime(iso: string | null, fallback: string | null) {
  if (!iso) return fallback ?? '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? fallback ?? ''
    : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtLength(sec: number | null) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}:${String(s).padStart(2, '0')}` : `${m} min`;
}

export function ServicePanel({ roomId }: { roomId: string }) {
  const [service, setService] = useState<RoomService | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () => getRoomService(roomId).then((s) => active && setService(s)).catch(() => {});
    load();
    const iv = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(iv);
    };
  }, [roomId]);

  // Nothing to show if this room has no Planning Center mapping.
  if (!service || !service.configured) return null;

  const next = service.plans[0] ?? null;
  const later = service.plans.slice(1);

  return (
    <section className="svc">
      <div className="svc__head">
        <h2 className="svc__title">Upcoming Service</h2>
        <span className={`svc__badge svc__badge--${service.live ? 'live' : 'mock'}`}>
          {service.live ? '● Planning Center' : '○ Sample data'}
        </span>
      </div>

      {!next && <p className="svc__muted">No upcoming plans.</p>}

      {next && (
        <div className="svc__next">
          {next.seriesTitle && <div className="svc__series">{next.seriesTitle}</div>}
          <div className="svc__plan">{next.title}</div>
          {next.dates && <div className="svc__date">{next.dates}</div>}
          <div className="svc__times">
            {next.times.map((t) => (
              <span key={t.id} className="svc__time">{fmtTime(t.startsAt, t.name)}</span>
            ))}
          </div>

          {next.items.length > 0 && (
            <div className="svc__order">
              <button className="svc__toggle" onClick={() => setOpen((o) => !o)}>
                {open ? '▾' : '▸'} Order of Service ({next.items.length})
              </button>
              {open && (
                <ol className="svc__items">
                  {next.items.map((it) => (
                    <li key={it.id} className="svc__item">
                      <span className="svc__item-title">{it.title}</span>
                      {it.type && <span className="svc__item-type">{it.type}</span>}
                      {it.length != null && <span className="svc__item-len">{fmtLength(it.length)}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      )}

      {later.length > 0 && (
        <div className="svc__later">
          <span className="svc__muted">Also upcoming:</span>{' '}
          {later.map((p) => p.dates).filter(Boolean).join(' · ')}
        </div>
      )}
    </section>
  );
}

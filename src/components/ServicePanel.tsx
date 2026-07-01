import { useEffect, useState } from 'react';
import { getRoomService, type RoomService } from '../api';

const REFRESH_MS = 5 * 60 * 1000;

// Clock time, prefixed with a short weekday when it's NOT on the service day
// (so a mid-week rehearsal reads "Wed 6:30 PM" instead of a bare time).
function fmtTime(iso: string | null, fallback: string | null, serviceDay?: string | null) {
  if (!iso) return fallback ?? '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback ?? '';
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (serviceDay && d.toDateString() !== serviceDay) {
    return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  }
  return time;
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

  // The service day = the first service time's day (fallback: first time).
  const serviceDay = (() => {
    if (!next) return null;
    const svc = next.times.find((t) => t.type === 'service') ?? next.times[0];
    return svc?.startsAt ? new Date(svc.startsAt).toDateString() : null;
  })();

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
          <div className="svc__type-name">{next.serviceTypeName}</div>
          {next.seriesTitle && <div className="svc__series">{next.seriesTitle}</div>}
          <div className="svc__plan">{next.title}</div>
          {next.dates && <div className="svc__date">{next.dates}</div>}
          <div className="svc__times">
            {next.times.map((t) => {
              const time = fmtTime(t.startsAt, t.name, serviceDay);
              // Rehearsals show their name (e.g. "2:00 PM · Run Through");
              // services stay as a bare clock time.
              const label = t.type === 'rehearsal' && t.name && t.startsAt ? `${time} · ${t.name}` : time;
              return (
                <span
                  key={t.id}
                  className={`svc__time svc__time--${t.type ?? 'service'}`}
                  title={t.type === 'rehearsal' ? 'Rehearsal' : t.name ?? undefined}
                >
                  {label}
                </span>
              );
            })}
          </div>
          {next.times.some((t) => t.type === 'rehearsal') && (
            <div className="svc__legend">
              <span className="svc__time svc__time--service">service</span>
              <span className="svc__time svc__time--rehearsal">rehearsal</span>
            </div>
          )}

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

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRooms, getRoomService, type RoomMeta, type ServicePlan } from '../api';
import { inCampus, useCampus } from '../layout/campus';

const REFRESH_MS = 5 * 60 * 1000;

interface EventRow {
  room: RoomMeta;
  plan: ServicePlan;
  live: boolean;
  startsAt: number | null; // first service time, for sorting + the date block
}

function firstServiceStart(plan: ServicePlan): number | null {
  const t = plan.times.find((x) => x.type === 'service' && x.startsAt) ?? plan.times[0];
  return t?.startsAt ? new Date(t.startsAt).getTime() : null;
}

function fmtTimes(plan: ServicePlan) {
  return plan.times
    .filter((t) => t.type === 'service' && t.startsAt)
    .map((t) => new Date(t.startsAt!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
}

// Campus-wide upcoming events, soonest first. Each row opens the Event Detail
// page (times, plan notes, startup checklist) — the operational front door.
export function Services() {
  const { campusId } = useCampus();
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [anyLive, setAnyLive] = useState(false);

  useEffect(() => {
    let on = true;
    const load = async () => {
      try {
        const all = await getRooms();
        if (!on) return;
        const results = await Promise.all(
          all.map((room) =>
            getRoomService(room.id)
              .then((s) =>
                s.configured
                  ? s.plans.map((plan) => ({ room, plan, live: s.live, startsAt: firstServiceStart(plan) }))
                  : [],
              )
              .catch(() => [] as EventRow[]),
          ),
        );
        if (!on) return;
        const rows = results.flat().sort((a, b) => (a.startsAt ?? Infinity) - (b.startsAt ?? Infinity));
        setEvents(rows);
        setAnyLive(rows.some((r) => r.live));
      } catch {
        /* keep last data */
      }
    };
    load();
    const iv = setInterval(load, REFRESH_MS);
    return () => {
      on = false;
      clearInterval(iv);
    };
  }, []);

  const visible = (events ?? []).filter((e) => inCampus(campusId, e.room.site));

  return (
    <div className="services">
      <div className="pagehead">
        <div>
          <h1 className="pagehead__title">Services</h1>
          <p className="pagehead__sub">Upcoming events across the campus</p>
        </div>
        <div className="pagehead__right">
          <span className={`svc__badge svc__badge--${anyLive ? 'live' : 'mock'}`}>
            {anyLive ? '● Planning Center' : '○ Sample data'}
          </span>
        </div>
      </div>

      {events === null && <p className="pagemsg">Loading…</p>}
      {events !== null && visible.length === 0 && (
        <p className="svc__muted">No upcoming events for this campus.</p>
      )}

      <div className="events">
        {visible.map(({ room, plan, startsAt }) => {
          const d = startsAt ? new Date(startsAt) : null;
          return (
            <Link
              key={`${room.id}-${plan.id}`}
              className="eventrow"
              to={`/room/${room.id}/event/${plan.id}`}
            >
              <div className="eventrow__date">
                <span className="eventrow__dow">
                  {d ? d.toLocaleDateString([], { weekday: 'short' }) : '—'}
                </span>
                <span className="eventrow__day">{d ? d.getDate() : ''}</span>
                <span className="eventrow__mon">
                  {d ? d.toLocaleDateString([], { month: 'short' }) : ''}
                </span>
              </div>
              <div className="eventrow__body">
                <div className="eventrow__title">
                  {plan.title}
                  <span className="svc__type-name eventrow__type">{plan.serviceTypeName}</span>
                </div>
                <div className="eventrow__meta">
                  {room.name}
                  {plan.seriesTitle ? ` · ${plan.seriesTitle}` : ''}
                </div>
              </div>
              <div className="eventrow__times">
                {fmtTimes(plan).map((t, i) => (
                  <span key={i} className="svc__time">
                    {t}
                  </span>
                ))}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

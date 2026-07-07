import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Radio } from 'lucide-react';
import {
  getRoomService,
  getRoomState,
  getShow,
  type RoomMeta,
  type RoomService,
  type RoomState,
  type ShowState,
} from '../api';

const REFRESH_MS = 30 * 1000;

function fmtNextTime(service: RoomService | null) {
  const next = service?.plans[0];
  if (!next) return null;
  const svc = next.times.filter((t) => t.type === 'service' && t.startsAt);
  // First service time still in the future; else the last one (mid-service).
  const t =
    svc.find((x) => new Date(x.startsAt!).getTime() > Date.now()) ?? svc[svc.length - 1] ?? null;
  return t?.startsAt
    ? new Date(t.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;
}

// One room on the campus Home: current mode, live-show badge, next event.
// The whole card clicks into the room's status/operate page.
export function RoomCard({ room }: { room: RoomMeta }) {
  const [state, setState] = useState<RoomState | null>(null);
  const [show, setShow] = useState<ShowState | null>(null);
  const [service, setService] = useState<RoomService | null>(null);

  useEffect(() => {
    let on = true;
    const load = () => {
      getRoomState(room.id).then((s) => on && setState(s)).catch(() => on && setState(null));
      getShow(room.id).then((s) => on && setShow(s)).catch(() => {});
      getRoomService(room.id).then((s) => on && setService(s)).catch(() => {});
    };
    load();
    const iv = setInterval(load, REFRESH_MS);
    return () => {
      on = false;
      clearInterval(iv);
    };
  }, [room.id]);

  const mode = room.modes.find((m) => m.id === state?.mode) ?? null;
  const next = service?.plans[0] ?? null;
  const nextTime = fmtNextTime(service);

  return (
    <Link to={`/room/${room.id}`} className="roomcard">
      <div className="roomcard__head">
        <span className="roomcard__name">{room.name}</span>
        {show?.active && (
          <span className="roomcard__live">
            <Radio size={12} /> LIVE
          </span>
        )}
      </div>

      <div className="roomcard__mode">
        <span
          className="roomcard__dot"
          style={{ background: mode?.color ?? 'var(--text-faint)' }}
        />
        <span>{mode ? mode.label : state ? 'Unknown mode' : 'Connecting…'}</span>
        {state?.protection.active && (
          <span className="roomcard__lock" title={state.protection.label ?? 'Schedule protection'}>
            <Lock size={12} />
          </span>
        )}
        {state && !state.online && <span className="roomcard__offline">offline</span>}
      </div>

      {next ? (
        <div className="roomcard__next">
          <span className="roomcard__next-title">{next.title}</span>
          <span className="roomcard__next-when">
            {[next.dates, nextTime].filter(Boolean).join(' · ')}
          </span>
        </div>
      ) : (
        service?.configured && <div className="roomcard__next roomcard__next--none">No upcoming plans</div>
      )}
    </Link>
  );
}

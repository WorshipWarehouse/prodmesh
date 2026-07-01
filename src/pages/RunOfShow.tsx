import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  getRoom,
  getRoomPlan,
  type RoomMeta,
  type ServicePlan,
  type PlanTime,
} from '../api';
import { OrderOfService } from '../components/OrderOfService';
import { Clock } from '../components/Clock';

function timeLabel(t: PlanTime | null) {
  if (!t) return '';
  const clock = t.startsAt
    ? new Date(t.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';
  return [t.name, clock].filter(Boolean).join(' · ');
}

// Countdown to (or elapsed since) the selected service time.
function Countdown({ time }: { time: PlanTime | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  if (!time?.startsAt) return null;
  const diff = new Date(time.startsAt).getTime() - now;
  const past = diff < 0;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  const hhmmss = `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return (
    <div className={`ros-count ros-count--${past ? 'live' : 'pre'}`}>
      <span className="ros-count__label">{past ? 'Elapsed since start' : 'Starts in'}</span>
      <span className="ros-count__time">{hhmmss}</span>
      <span className="ros-count__at">{timeLabel(time)}</span>
    </div>
  );
}

export function RunOfShow() {
  const { roomId = '', planId = '' } = useParams();
  const [params] = useSearchParams();
  const timeId = params.get('time');

  const [room, setRoom] = useState<RoomMeta | null>(null);
  const [plan, setPlan] = useState<ServicePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);

  useEffect(() => {
    getRoom(roomId).then(setRoom).catch(() => setError('Room not found'));
  }, [roomId]);
  useEffect(() => {
    getRoomPlan(roomId, planId).then((r) => setPlan(r.plan)).catch(() => setError('Plan not found'));
  }, [roomId, planId]);

  // Restore/persist the tracked position so a refresh keeps our place.
  useEffect(() => {
    setCurrentId(localStorage.getItem(`ros:${planId}`) || null);
  }, [planId]);
  const setCurrent = useCallback(
    (id: string | null) => {
      setCurrentId(id);
      if (id) localStorage.setItem(`ros:${planId}`, id);
      else localStorage.removeItem(`ros:${planId}`);
    },
    [planId],
  );

  if (error) {
    return (
      <div className="ros ros--msg">
        <p>{error}</p>
        <Link className="status__back" to={`/room/${roomId}`}>← Back to room</Link>
      </div>
    );
  }
  if (!room || !plan) return <div className="ros ros--msg">Loading…</div>;

  const selectedTime =
    plan.times.find((t) => t.id === timeId) ?? plan.times.find((t) => t.type === 'service') ?? null;
  const trackable = plan.items.filter((i) => (i.type ?? 'item') !== 'header');
  const idx = trackable.findIndex((i) => i.id === currentId);
  const step = (delta: number) => {
    const n = idx < 0 ? (delta > 0 ? 0 : -1) : idx + delta;
    if (n >= 0 && n < trackable.length) setCurrent(trackable[n].id);
  };
  const currentItem = idx >= 0 ? trackable[idx] : null;

  return (
    <div className="ros">
      <header className="ros__header">
        <div>
          <Link className="status__back" to={`/room/${roomId}`}>← {room.name}</Link>
          <h1 className="ros__title">{plan.title}</h1>
          <p className="ros__sub">
            {[plan.serviceTypeName, plan.seriesTitle, plan.dates].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Clock />
      </header>

      <section className="ros__widgets">
        <Countdown time={selectedTime} />
        <div className="ros-track">
          <div className="ros-track__now">
            <span className="ros-track__label">Now</span>
            <span className="ros-track__title">{currentItem ? currentItem.title : '—'}</span>
          </div>
          <div className="ros-track__buttons">
            <button className="btn" onClick={() => step(-1)} disabled={idx <= 0}>◀ Prev</button>
            <button className="btn btn--primary" onClick={() => step(1)} disabled={idx >= 0 && idx >= trackable.length - 1}>
              Next ▶
            </button>
            <button className="btn btn--ghost" onClick={() => setCurrent(null)} disabled={idx < 0}>Reset</button>
          </div>
        </div>
      </section>

      <section className="ros__order">
        <h2 className="ros__order-title">Run of Show</h2>
        <p className="ros__hint">Tap an item to mark where you are. (Live ProPresenter auto-tracking coming next.)</p>
        <OrderOfService items={plan.items} currentId={currentId} onSelect={setCurrent} />
      </section>
    </div>
  );
}

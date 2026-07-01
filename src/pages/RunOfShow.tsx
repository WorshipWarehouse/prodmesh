import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [follow, setFollow] = useState(true);
  const [ppConnected, setPpConnected] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<{ index: number | null; count: number | null }>({
    index: null,
    count: null,
  });

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

  // Live ProPresenter tracking via SSE. In "follow" mode it auto-advances the
  // highlight; a manual tap drops out of follow (override) until re-enabled.
  const followRef = useRef(follow);
  followRef.current = follow;
  const lastPpRef = useRef<string | null>(null);
  useEffect(() => {
    const es = new EventSource(`/api/rooms/${roomId}/run/${planId}/stream`);
    es.addEventListener('status', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setPpConnected(Boolean(d.configured) && d.online !== false);
    });
    es.addEventListener('active', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      lastPpRef.current = d.itemId ?? null;
      if (followRef.current && d.itemId) setCurrent(d.itemId);
      setProgress({ index: d.slideIndex ?? null, count: d.slideCount ?? null });
    });
    es.onerror = () => setPpConnected(false);
    return () => es.close();
  }, [roomId, planId, setCurrent]);

  const selectManually = (id: string) => {
    setFollow(false);
    setCurrent(id);
  };
  const resumeFollow = () => {
    setFollow(true);
    if (lastPpRef.current) setCurrent(lastPpRef.current);
  };

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
    setFollow(false); // manual navigation overrides follow
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
          <div
            className={`ros-track__status ros-track__status--${
              ppConnected === null ? 'idle' : !ppConnected ? 'off' : follow ? 'follow' : 'manual'
            }`}
          >
            <span>
              {ppConnected === null
                ? '· connecting to ProPresenter…'
                : !ppConnected
                  ? '○ ProPresenter offline — manual mode'
                  : follow
                    ? '● Following ProPresenter'
                    : '❙❙ Manual override'}
            </span>
            {ppConnected && !follow && (
              <button className="btn btn--sm" onClick={resumeFollow}>Resume follow</button>
            )}
          </div>
          <div className="ros-track__now">
            <span className="ros-track__label">Now</span>
            <span className="ros-track__title">{currentItem ? currentItem.title : '—'}</span>
          </div>
          {progress.count != null && progress.index != null && (
            <div className="ros-progress">
              <div className="ros-progress__bar">
                <div
                  className="ros-progress__fill"
                  style={{ width: `${Math.min(100, ((progress.index + 1) / progress.count) * 100)}%` }}
                />
              </div>
              <span className="ros-progress__label">
                Slide {progress.index + 1} / {progress.count}
              </span>
            </div>
          )}
          <div className="ros-track__buttons">
            <button className="btn" onClick={() => step(-1)} disabled={idx <= 0}>◀ Prev</button>
            <button className="btn btn--primary" onClick={() => step(1)} disabled={idx >= 0 && idx >= trackable.length - 1}>
              Next ▶
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => { setFollow(false); setCurrent(null); }}
              disabled={idx < 0}
            >
              Reset
            </button>
          </div>
        </div>
      </section>

      <section className="ros__order">
        <h2 className="ros__order-title">Run of Show</h2>
        <p className="ros__hint">Follows ProPresenter live. Tap an item to override; “Resume follow” to hand control back.</p>
        <OrderOfService items={plan.items} currentId={currentId} onSelect={selectManually} />
      </section>
    </div>
  );
}

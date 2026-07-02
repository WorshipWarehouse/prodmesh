import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  getRoom,
  getRoomPlan,
  startShow,
  endShow,
  setShowCurrent,
  type RoomMeta,
  type ServicePlan,
  type PlanTime,
  type ShowState,
} from '../api';
import { OrderOfService } from '../components/OrderOfService';

function timeLabel(t: PlanTime | null) {
  if (!t) return '';
  const clock = t.startsAt
    ? new Date(t.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';
  return [t.name, clock].filter(Boolean).join(' · ');
}

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
  const timeId = params.get('time') || 'default';

  const [room, setRoom] = useState<RoomMeta | null>(null);
  const [plan, setPlan] = useState<ServicePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<ShowState>({ active: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getRoom(roomId).then(setRoom).catch(() => setError('Room not found'));
  }, [roomId]);
  useEffect(() => {
    getRoomPlan(roomId, planId).then((r) => setPlan(r.plan)).catch(() => setError('Plan not found'));
  }, [roomId, planId]);

  // The server is the source of truth; we just render its show state.
  useEffect(() => {
    const es = new EventSource(`/api/rooms/${roomId}/show/stream`);
    es.addEventListener('state', (e) => {
      try {
        setState(JSON.parse((e as MessageEvent).data));
      } catch {
        /* ignore */
      }
    });
    return () => es.close();
  }, [roomId]);

  if (error) {
    return (
      <div className="pagemsg">
        <p>{error}</p>
        <Link className="backlink" to={`/room/${roomId}`}>← Back to room</Link>
      </div>
    );
  }
  if (!room || !plan) return <div className="pagemsg">Loading…</div>;

  const isThisShow = state.active && state.planId === planId && state.timeId === timeId;
  const isOtherShow = state.active && !isThisShow;
  const cur = isThisShow ? state.current : null;
  const currentId = cur?.itemId ?? null;
  const follow = isThisShow ? Boolean(state.follow) : false;
  const ppConnected = isThisShow ? state.ppConnected : null;

  const selectedTime =
    plan.times.find((t) => t.id === timeId) ?? plan.times.find((t) => t.type === 'service') ?? null;
  const trackable = plan.items.filter((i) => (i.type ?? 'item') !== 'header');
  const idx = trackable.findIndex((i) => i.id === currentId);
  const currentItem = idx >= 0 ? trackable[idx] : null;

  const act = async (fn: () => Promise<ShowState>) => {
    setBusy(true);
    try {
      setState(await fn());
    } catch {
      /* SSE will reconcile */
    } finally {
      setBusy(false);
    }
  };
  const pick = (itemId: string) => act(() => setShowCurrent(roomId, { itemId }));
  const step = (delta: number) => {
    const n = idx < 0 ? (delta > 0 ? 0 : -1) : idx + delta;
    if (n >= 0 && n < trackable.length) pick(trackable[n].id);
  };

  return (
    <div className="ros">
      <div className="pagehead">
        <div>
          <h1 className="pagehead__title">{plan.title}</h1>
          <p className="pagehead__sub">
            {[plan.serviceTypeName, plan.seriesTitle, plan.dates].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="pagehead__right">
          <Link
            className="btn btn--sm"
            to={`/room/${roomId}/run/${planId}/report${timeId !== 'default' ? `?time=${timeId}` : ''}`}
          >
            📊 Timing report
          </Link>
        </div>
      </div>

      <section className="ros__widgets">
        <Countdown time={selectedTime} />

        <div className="ros-track">
          {isOtherShow ? (
            <div className="ros-track__status ros-track__status--off">
              <span>■ Another show is live in this room</span>
              <Link className="btn btn--sm" to={`/room/${roomId}/run/${state.planId}?time=${state.timeId}`}>
                Go to it
              </Link>
            </div>
          ) : !isThisShow ? (
            <div className="ros-track__start">
              <span className="ros-track__status ros-track__status--idle">No show running</span>
              <button className="btn btn--primary" disabled={busy} onClick={() => act(() => startShow(roomId, planId, timeId))}>
                ▶ Start Show
              </button>
            </div>
          ) : (
            <>
              <div
                className={`ros-track__status ros-track__status--${
                  ppConnected == null ? 'idle' : !ppConnected ? 'off' : follow ? 'follow' : 'manual'
                }`}
              >
                <span>
                  {ppConnected == null
                    ? '· connecting to ProPresenter…'
                    : !ppConnected
                      ? '○ ProPresenter offline — manual mode'
                      : follow
                        ? '● Following ProPresenter'
                        : '❙❙ Manual override'}
                </span>
                {ppConnected && !follow && (
                  <button className="btn btn--sm" disabled={busy} onClick={() => act(() => setShowCurrent(roomId, { follow: true }))}>
                    Resume follow
                  </button>
                )}
              </div>
              <div className="ros-track__now">
                <span className="ros-track__label">Now</span>
                <span className="ros-track__title">{currentItem ? currentItem.title : '—'}</span>
              </div>
              {cur?.slideCount != null && cur?.slideIndex != null && (
                <div className="ros-progress">
                  <div className="ros-progress__bar">
                    <div
                      className="ros-progress__fill"
                      style={{ width: `${Math.min(100, ((cur.slideIndex + 1) / cur.slideCount) * 100)}%` }}
                    />
                  </div>
                  <span className="ros-progress__label">Slide {cur.slideIndex + 1} / {cur.slideCount}</span>
                </div>
              )}
              <div className="ros-track__buttons">
                <button className="btn" disabled={busy || idx <= 0} onClick={() => step(-1)}>◀ Prev</button>
                <button className="btn btn--primary" disabled={busy || (idx >= 0 && idx >= trackable.length - 1)} onClick={() => step(1)}>
                  Next ▶
                </button>
                <button className="btn btn--ghost" disabled={busy} onClick={() => act(() => endShow(roomId))}>
                  ■ End Show
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="ros__order">
        <h2 className="ros__order-title">Run of Show</h2>
        <p className="ros__hint">
          {isThisShow
            ? 'Following ProPresenter live. Tap an item to override.'
            : 'Start the show to track it live and record timing.'}
        </p>
        <OrderOfService items={plan.items} currentId={currentId} onSelect={isThisShow ? pick : undefined} />
      </section>
    </div>
  );
}

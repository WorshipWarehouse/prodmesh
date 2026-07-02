import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  getRoom,
  getRoomPlan,
  getReport,
  startShow,
  endShow,
  setShowCurrent,
  type RoomMeta,
  type ServicePlan,
  type PlanTime,
  type PpTimer,
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

function hhmmss(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function fmtSecondsOfDay(sec: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setSeconds(sec);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// The room's ProPresenter timer wins when it's running (the operator's Message
// re-targets + starts it between services); otherwise fall back to clock math
// against the Planning Center service time.
function Countdown({ time, timer }: { time: PlanTime | null; timer: PpTimer | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  if (timer && timer.state === 'running' && timer.remainingSeconds != null) {
    const target =
      timer.targetSecondsOfDay != null ? ` → ${fmtSecondsOfDay(timer.targetSecondsOfDay)}` : '';
    return (
      <div className="ros-count ros-count--pre">
        <span className="ros-count__label">Starts in</span>
        <span className="ros-count__time">{hhmmss(timer.remainingSeconds)}</span>
        <span className="ros-count__at">⏱ {timer.name}{target}</span>
      </div>
    );
  }

  if (!time?.startsAt) return null;
  const diff = new Date(time.startsAt).getTime() - now;
  const past = diff < 0;
  return (
    <div className={`ros-count ros-count--${past ? 'live' : 'pre'}`}>
      <span className="ros-count__label">{past ? 'Elapsed since start' : 'Starts in'}</span>
      <span className="ros-count__time">{hhmmss(Math.abs(diff) / 1000)}</span>
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
  const [completedAt, setCompletedAt] = useState<number | null>(null);

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

  // A previously ended show stays "Complete" even after reopening this page —
  // the timeline's completion stamp is the source of truth. Refetched when the
  // show state flips so ending a show marks it complete immediately.
  useEffect(() => {
    let on = true;
    getReport(roomId, planId, timeId)
      .then((r) => on && setCompletedAt(r?.completedAt ?? null))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [roomId, planId, timeId, state.active]);

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
        <Countdown time={selectedTime} timer={state.timer ?? null} />

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
              {completedAt ? (
                <>
                  <span className="ros-track__status ros-track__status--done">
                    ✓ Complete ·{' '}
                    {new Date(completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => act(() => startShow(roomId, planId, timeId))}>
                    Reopen show
                  </button>
                </>
              ) : (
                <>
                  <span className="ros-track__status ros-track__status--idle">No show running</span>
                  <button className="btn btn--primary" disabled={busy} onClick={() => act(() => startShow(roomId, planId, timeId))}>
                    ▶ Start Show
                  </button>
                </>
              )}
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
            : completedAt
              ? 'This service is complete — see the timing report for how it ran.'
              : 'Start the show to track it live and record timing.'}
        </p>
        <OrderOfService items={plan.items} currentId={currentId} onSelect={isThisShow ? pick : undefined} />
      </section>
    </div>
  );
}

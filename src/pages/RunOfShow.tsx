import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { hhmmss } from '../lib/duration';
import {
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  MonitorOff,
  Pause,
  Play,
  Radio,
  Square,
  Timer as TimerIcon,
  Volume2,
} from 'lucide-react';
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
  type SplState,
} from '../api';
import { OrderOfService } from '../components/OrderOfService';

function timeLabel(t: PlanTime | null) {
  if (!t) return '';
  const clock = t.startsAt
    ? new Date(t.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';
  return [t.name, clock].filter(Boolean).join(' · ');
}

function fmtSecondsOfDay(sec: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setSeconds(sec);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// The room's ProPresenter timer wins when it's running (the operator's Message
// re-targets + starts it between services); otherwise fall back to clock math
// against the Planning Center service time. A completed service freezes into
// its recorded length — no counter should keep running on a finished show.
function Countdown({
  time,
  timer,
  completed,
}: {
  time: PlanTime | null;
  timer: PpTimer | null;
  completed: { startedAt: number | null; completedAt: number } | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  if (completed) {
    const length =
      completed.startedAt != null ? (completed.completedAt - completed.startedAt) / 1000 : null;
    return (
      <div className="ros-count ros-count--done">
        <span className="ros-count__label">Service length</span>
        <span className="ros-count__time">{length != null ? hhmmss(length) : '—'}</span>
        <span className="ros-count__at">
          Ended {new Date(completed.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </span>
      </div>
    );
  }

  if (timer && timer.state === 'running' && timer.remainingSeconds != null) {
    const target =
      timer.targetSecondsOfDay != null ? ` → ${fmtSecondsOfDay(timer.targetSecondsOfDay)}` : '';
    return (
      <div className="ros-count ros-count--pre">
        <span className="ros-count__label">Starts in</span>
        <span className="ros-count__time">{hhmmss(timer.remainingSeconds)}</span>
        <span className="ros-count__at">
          <TimerIcon size={13} /> {timer.name}{target}
        </span>
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

// Live room loudness. Color tells the story at a glance: green under target,
// amber between target and limit, red over the limit.
function SplMeter({ spl }: { spl: SplState | null }) {
  if (!spl) return null;
  const zone =
    spl.limit != null && spl.current >= spl.limit
      ? 'over'
      : spl.target != null && spl.current >= spl.target
        ? 'warn'
        : 'ok';
  // Meter bar spans a fixed 70–100 dB window (where worship services live).
  const pct = Math.min(100, Math.max(0, ((spl.current - 70) / 30) * 100));
  return (
    <div className={`ros-spl ros-spl--${zone}`}>
      <span className="ros-count__label">
        <Volume2 size={13} /> Loudness
      </span>
      <span className="ros-spl__db">
        {spl.current.toFixed(1)} <small>dB</small>
      </span>
      <div className="ros-spl__bar">
        <div className="ros-spl__fill" style={{ width: `${pct}%` }} />
        {spl.target != null && (
          <div className="ros-spl__mark ros-spl__mark--target" style={{ left: `${((spl.target - 70) / 30) * 100}%` }} />
        )}
        {spl.limit != null && (
          <div className="ros-spl__mark ros-spl__mark--limit" style={{ left: `${((spl.limit - 70) / 30) * 100}%` }} />
        )}
      </div>
      <span className="ros-spl__stats">
        {spl.avg != null ? `avg ${spl.avg.toFixed(1)}` : 'avg —'}
        {' · '}
        {spl.peak != null ? `peak ${spl.peak.toFixed(1)}` : 'peak —'}
        {spl.target != null && ` · target ${spl.target}`}
      </span>
      {spl.ca && <CaGauge ca={spl.ca} />}
    </div>
  );
}

// C-A ratio (bass pressure) with the analyzer's target band. High C-A is the
// mix older ears complain about even at a safe overall level.
function CaGauge({ ca }: { ca: NonNullable<SplState['ca']> }) {
  // Fixed 0–20 dB scale — where music C-A lives.
  const pos = (v: number) => Math.min(100, Math.max(0, (v / 20) * 100));
  const zone = ca.hi != null && ca.current > ca.hi ? 'over' : ca.lo != null && ca.current < ca.lo ? 'low' : 'ok';
  return (
    <div className={`ros-ca ros-ca--${zone}`}>
      <span className="ros-ca__head">
        <span className="ros-count__label">C-A</span>
        <span className="ros-ca__val">
          {ca.current.toFixed(1)} <small>dB</small>
        </span>
      </span>
      <div className="ros-ca__track">
        {ca.lo != null && ca.hi != null && (
          <div
            className="ros-ca__band"
            style={{ left: `${pos(ca.lo)}%`, width: `${pos(ca.hi) - pos(ca.lo)}%` }}
          />
        )}
        <div className="ros-ca__dot" style={{ left: `${pos(ca.current)}%` }} />
      </div>
      <span className="ros-spl__stats">
        {ca.avg != null ? `avg ${ca.avg.toFixed(1)}` : 'avg —'}
        {' · '}
        {ca.max != null ? `max ${ca.max.toFixed(1)}` : 'max —'}
        {ca.lo != null && ca.hi != null && ` · band ${ca.lo}–${ca.hi}`}
      </span>
    </div>
  );
}

export function RunOfShow() {
  const { roomId = '', planId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const timeId = params.get('time') || 'default';
  const isRehearsal = timeId.startsWith('rehearsal-');

  const [room, setRoom] = useState<RoomMeta | null>(null);
  const [plan, setPlan] = useState<ServicePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<ShowState>({ active: false });
  const [busy, setBusy] = useState(false);
  const [completedAt, setCompletedAt] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

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
      .then((r) => {
        if (!on) return;
        setCompletedAt(r?.completedAt ?? null);
        setStartedAt(r?.startedAt ?? null);
      })
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

  // A rehearsal gets its own synthetic timeId from the server; adopting it
  // into the URL makes this page (and its report link) track that instance.
  const startRehearsal = async () => {
    setBusy(true);
    try {
      const next = await startShow(roomId, planId, timeId, { rehearsal: true });
      setState(next);
      if (next.timeId) setParams({ time: next.timeId }, { replace: true });
    } catch {
      /* SSE will reconcile */
    } finally {
      setBusy(false);
    }
  };
  const step = (delta: number) => {
    const n = idx < 0 ? (delta > 0 ? 0 : -1) : idx + delta;
    if (n >= 0 && n < trackable.length) pick(trackable[n].id);
  };

  return (
    <div className="ros">
      <div className="pagehead">
        <div>
          <Link className="backlink" to={`/room/${roomId}/event/${planId}`}>← Event details</Link>
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
            <BarChart3 size={14} /> Show report
          </Link>
        </div>
      </div>

      <section className="ros__widgets">
        <Countdown
          time={selectedTime}
          timer={state.timer ?? null}
          completed={!isThisShow && completedAt != null ? { startedAt, completedAt } : null}
        />
        <SplMeter spl={state.spl ?? null} />

        <div className="ros-track">
          {isOtherShow ? (
            <div className="ros-track__status ros-track__status--off">
              <span><Radio size={14} /> Another show is live in this room</span>
              <Link className="btn btn--sm" to={`/room/${roomId}/run/${state.planId}?time=${state.timeId}`}>
                Go to it
              </Link>
            </div>
          ) : !isThisShow ? (
            <div className="ros-track__start">
              {completedAt ? (
                <>
                  <span className="ros-track__status ros-track__status--done">
                    <CheckCircle2 size={15} /> Complete ·{' '}
                    {new Date(completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => act(() => startShow(roomId, planId, timeId))}>
                    Reopen show
                  </button>
                  <button className="btn btn--ghost btn--sm" disabled={busy} onClick={startRehearsal} title="Practice run — records timing under its own instance, never against the service">
                    Start Rehearsal
                  </button>
                </>
              ) : (
                <>
                  <span className="ros-track__status ros-track__status--idle">No show running</span>
                  <button className="btn btn--primary" disabled={busy} onClick={() => act(() => startShow(roomId, planId, timeId))}>
                    <Play size={15} /> Start Show
                  </button>
                  <button className="btn btn--ghost btn--sm" disabled={busy} onClick={startRehearsal} title="Practice run — records timing under its own instance, never against the service">
                    Start Rehearsal
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
                  {isRehearsal && <span className="ros-rehearsal">Rehearsal</span>}
                  {ppConnected == null ? (
                    'connecting to ProPresenter…'
                  ) : !ppConnected ? (
                    <><MonitorOff size={14} /> ProPresenter offline — manual mode</>
                  ) : follow ? (
                    <><Radio size={14} /> Following ProPresenter</>
                  ) : (
                    <><Pause size={14} /> Manual override</>
                  )}
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
                <button className="btn" disabled={busy || idx <= 0} onClick={() => step(-1)}>
                  <ChevronLeft size={16} /> Prev
                </button>
                <button className="btn btn--primary" disabled={busy || (idx >= 0 && idx >= trackable.length - 1)} onClick={() => step(1)}>
                  Next <ChevronRight size={16} />
                </button>
                <button className="btn btn--ghost" disabled={busy} onClick={() => act(() => endShow(roomId))}>
                  <Square size={13} /> End Show
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
              ? 'This service is complete — see the show report for how it ran.'
              : 'Start the show to track it live and record timing.'}
        </p>
        <OrderOfService items={plan.items} currentId={currentId} onSelect={isThisShow ? pick : undefined} />
      </section>
    </div>
  );
}

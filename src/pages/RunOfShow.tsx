import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
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
  type ShowState,
} from '../api';
import { OrderOfService } from '../components/OrderOfService';
import { useTopic, roomTopic } from '../lib/stream';
import { useQuery, invalidate } from '../lib/useQuery';
import { planKey, reportKey } from '../lib/keys';
import { widgetRegistry } from '../widgets/registry';
import type { WidgetType } from '../widgets/types';

// Run of Show's widget row, in order. A hard-coded layout for now — 1.5 reads
// the equivalent list out of a stored dashboard instead, which is the only
// part that changes.
const ROS_WIDGETS: WidgetType[] = ['countdown', 'loudness'];

export function RunOfShow() {
  const { roomId = '', planId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const timeId = params.get('time') || 'default';
  const isRehearsal = timeId.startsWith('rehearsal-');

  const [room, setRoom] = useState<RoomMeta | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getRoom(roomId).then(setRoom).catch(() => setRoomError('Room not found'));
  }, [roomId]);

  // Through useQuery on the SHARED keys, not a bespoke fetch: the widgets in
  // this page's own grid ask for the same plan and report, and only a matching
  // key turns that into one request instead of two.
  const planQ = useQuery(planKey(roomId, planId), () => getRoomPlan(roomId, planId), {
    staleMs: 10 * 60_000,
  });
  const plan: ServicePlan | null = planQ.data?.plan ?? null;
  const error = roomError ?? (planQ.error ? 'Plan not found' : null);

  // The server is the source of truth; we just render its state. This page
  // wants only the show facet — the timer and loudness topics belong to the
  // widgets that display them, which is what lets those widgets be placed
  // anywhere without this page arranging it.
  const liveShow = useTopic<ShowState>(roomTopic.show(roomId));

  // Start/End return the new state too. The push normally beats the response
  // (the server publishes before it replies), but if the stream is mid-
  // reconnect it won't — and Start Show appearing to do nothing is the worst
  // possible moment for that. So an action's result is held until the next
  // push arrives, identified by `liveShow` becoming a different object.
  const [acted, setActed] = useState<{ from: unknown; state: ShowState } | null>(null);
  const state = acted && acted.from === liveShow ? acted.state : (liveShow ?? { active: false });

  // Pin the widgets to the service this page is about, rather than letting
  // them follow the room's next one.
  const widgetConfig = useMemo(() => ({ planId, timeId }), [planId, timeId]);

  // A previously ended show stays "Complete" even after reopening this page —
  // the timeline's completion stamp is the source of truth.
  const reportK = reportKey(roomId, planId, timeId);
  const completedAt =
    useQuery(reportK, () => getReport(roomId, planId, timeId), { staleMs: 30_000 }).data
      ?.completedAt ?? null;

  // Ending a show has to mark it complete now, not in 30s — so the flip in
  // show state is what invalidates the cached report, for this page and for
  // every widget sharing the key.
  useEffect(() => {
    invalidate(reportK);
  }, [reportK, state.active]);

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

  const trackable = plan.items.filter((i) => (i.type ?? 'item') !== 'header');
  const idx = trackable.findIndex((i) => i.id === currentId);
  const currentItem = idx >= 0 ? trackable[idx] : null;

  const act = async (fn: () => Promise<ShowState>) => {
    setBusy(true);
    try {
      setActed({ from: liveShow, state: await fn() });
    } catch {
      /* the stream reconciles */
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
      setActed({ from: liveShow, state: next });
      if (next.timeId) setParams({ time: next.timeId }, { replace: true });
    } catch {
      /* the stream reconciles */
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
        {/* Through the registry rather than as direct imports: this page is the
            first consumer of the same path a stored dashboard layout will take,
            so if the contract is wrong it is wrong here first. */}
        {ROS_WIDGETS.map((type) => {
          const W = widgetRegistry[type].component;
          return <W key={type} roomId={roomId} config={widgetConfig} />;
        })}

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

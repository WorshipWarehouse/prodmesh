import { useEffect, useState } from 'react';
import { Timer as TimerIcon } from 'lucide-react';
import { hhmmss } from '../lib/duration';
import { useTopic, roomTopic } from '../lib/stream';
import { useQuery } from '../lib/useQuery';
import { planKey, reportKey, roomServiceKey } from '../lib/keys';
import {
  getReport,
  getRoomPlan,
  getRoomService,
  type PlanTime,
  type PpTimer,
  type ShowState,
} from '../api';
import type { WidgetProps } from './types';

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

const firstServiceTime = (times: PlanTime[]) =>
  times.find((t) => t.type === 'service') ?? times[0] ?? null;

/**
 * Time until the service starts.
 *
 * The room's ProPresenter timer wins when it's running (the operator's Message
 * re-targets + starts it between services); otherwise fall back to clock math
 * against the Planning Center service time. A completed service freezes into
 * its recorded length — no counter should keep running on a finished show.
 *
 * Config `planId`/`timeId` pin it to one service (Run of Show does this).
 * Without them it follows whatever the room's next plan is, which is what a
 * dashboard placement wants — a lobby screen shouldn't need reconfiguring
 * every week.
 */
export function CountdownWidget({ roomId, config }: WidgetProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const timer = useTopic<PpTimer | null>(roomTopic.timer(roomId));
  const show = useTopic<ShowState>(roomTopic.show(roomId));

  // Pinned to a plan, or following the room's next one. Same cache keys the
  // pages use, so neither branch costs a request the page wasn't already making.
  const pinned = config.planId ?? null;
  const pinnedPlan = useQuery(
    pinned ? planKey(roomId, pinned) : null,
    () => getRoomPlan(roomId, pinned!),
    { staleMs: 10 * 60_000 },
  ).data?.plan;
  const nextPlan = useQuery(
    pinned ? null : roomServiceKey(roomId),
    () => getRoomService(roomId),
    { pollMs: 5 * 60_000, staleMs: 5 * 60_000 },
  ).data?.plans[0];

  const plan = pinned ? pinnedPlan : nextPlan;
  const planId = plan?.id ?? null;
  const time = plan
    ? (config.timeId ? plan.times.find((t) => t.id === config.timeId) : null) ??
      firstServiceTime(plan.times)
    : null;
  const timeId = config.timeId ?? time?.id ?? null;

  // A finished service shows its length instead of a counter. Only asked for
  // once there is a plan to ask about, and only when this show isn't live.
  const isLive = show?.active && show.planId === planId && show.timeId === timeId;
  const report = useQuery(
    planId && !isLive ? reportKey(roomId, planId, timeId) : null,
    () => getReport(roomId, planId!, timeId),
    { staleMs: 30_000 },
  ).data;
  const completedAt = !isLive ? (report?.completedAt ?? null) : null;

  if (completedAt != null) {
    const startedAt = report?.startedAt ?? null;
    const length = startedAt != null ? (completedAt - startedAt) / 1000 : null;
    return (
      <div className="ros-count ros-count--done">
        <span className="ros-count__label">Service length</span>
        <span className="ros-count__time">{length != null ? hhmmss(length) : '—'}</span>
        <span className="ros-count__at">
          Ended {new Date(completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
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

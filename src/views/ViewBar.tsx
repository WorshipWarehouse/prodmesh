import { useEffect, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronDown, Clock, LayoutGrid, Link2, Link2Off, Radio } from 'lucide-react';
import { hhmmss } from '../lib/duration';
import { resolveFollowing } from '../lib/following';
import { useNow } from '../lib/useNow';
import { useTopic, roomTopic } from '../lib/stream';
import type { ServicePlan, ShowState, ViewSummary } from '../api';
import type { WidgetConfig } from '../widgets/types';

// ─────────────────────────────────────────────────────────────────────────────
//  The dashboard's one header row: which dashboard, which event, which service
//  time, and whether the room is live.
//
//  ONE bar, not a page header plus a filter bar. A dashboard is a wall of
//  information and the chrome above it is overhead — every row of padding
//  spent naming the page is a row not spent on what you came to look at. So
//  the title becomes the first control: picking a different dashboard is the
//  same gesture as reading which one you are on.
//
//  Each control is a native <select> laid transparently over its own face.
//  That keeps the platform's keyboard handling, screen-reader behaviour and
//  touch pickers — which a hand-rolled popover would have to reimplement and
//  get subtly wrong on a booth tablet — while still showing a value with its
//  label underneath, which a bare <select> cannot.
// ─────────────────────────────────────────────────────────────────────────────

function Control({
  icon,
  display,
  caption,
  children,
  ...select
}: {
  icon: ReactNode;
  /** The line people read. */
  display: string;
  /** The quiet line under it — what this control is. */
  caption: string;
  children: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={`viewbar__ctl${select.disabled ? ' viewbar__ctl--off' : ''}`}>
      {/* The face is decoration: it repeats what the <select> underneath
          already announces, so hiding it is what stops a screen reader
          reading every control twice. */}
      <span className="viewbar__icon" aria-hidden>{icon}</span>
      <span className="viewbar__stack" aria-hidden>
        <span className="viewbar__value">{display}</span>
        <span className="viewbar__caption">{caption}</span>
      </span>
      <ChevronDown className="viewbar__chev" size={15} aria-hidden />
      <select className="viewbar__select" {...select}>
        {children}
      </select>
    </div>
  );
}

/** Time since the show started, ticking. Mounted only while one is live. */
function LiveClock({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="viewbar__elapsed mono">{hhmmss((now - since) / 1000)}</span>;
}

const FOLLOW = '';

const clockOf = (time: { startsAt: string | null }) =>
  time.startsAt
    ? new Date(time.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;

export function ViewBar({
  roomId,
  view,
  siblings,
  plans,
  config,
  onChange,
  actions,
}: {
  roomId: string;
  view: ViewSummary;
  /** The room's other dashboards — the title doubles as the switcher. */
  siblings: ViewSummary[];
  plans: ServicePlan[];
  config: WidgetConfig;
  onChange: (next: WidgetConfig) => void;
  /** Trailing buttons — Edit, once there is an editor. */
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  const show = useTopic<ShowState>(roomTopic.show(roomId));
  const live = show?.active ? show : null;

  const plan = plans.find((p) => p.id === config.planId) ?? null;

  // No pinned plan IS "follow the room" — the empty config every widget
  // already resolves to the room's own next service on its own. The bar just
  // names that state and shows which event it currently resolves to, so the
  // control never reads blank.
  const following = !plan;
  // Resolved through the SAME function the widgets use. Computing it a second
  // way here is how a header ends up quietly disagreeing with the cards under
  // it, which is worse than not showing it at all.
  const followed = resolveFollowing(plans, show, useNow(60_000));
  const shown = plan ?? followed.plan;
  const time = following
    ? followed.time
    : (plan?.times.find((t) => t.id === config.timeId) ?? null);

  return (
    <div className="viewbar">
      <Control
        icon={<LayoutGrid size={17} />}
        display={view.name}
        caption="Dashboard"
        aria-label="Dashboard"
        value={view.slug}
        onChange={(e) => navigate(`/room/${roomId}/view/${e.target.value}`)}
      >
        {siblings.map((v) => (
          <option key={v.id} value={v.slug}>{v.name}</option>
        ))}
      </Control>

      <Control
        icon={<CalendarDays size={17} />}
        display={shown ? (shown.dates ?? shown.title) : 'No events'}
        caption={following ? 'Following the room' : (shown?.serviceTypeName ?? 'Event')}
        aria-label="Event"
        disabled={plans.length === 0}
        value={shown?.id ?? ''}
        // Picking an event pins to it. Following is a default, not a mode you
        // have to leave first.
        onChange={(e) => onChange({ planId: e.target.value })}
      >
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {[p.title, p.dates].filter(Boolean).join(' · ')}
          </option>
        ))}
      </Control>

      {/* Following is a state of the dashboard, not one entry in a list of
          events — a list where every other row is a date. So it is a toggle,
          and turning it off pins to whatever was already on screen rather than
          jumping somewhere new. */}
      <button
        type="button"
        className={`viewbar__toggle${following ? ' viewbar__toggle--on' : ''}`}
        aria-pressed={following}
        aria-label="Follow the room’s next service"
        title={
          following
            ? 'Following the room’s next service — click to pin this event'
            : 'Pinned to one event — click to follow the room again'
        }
        disabled={plans.length === 0}
        onClick={() => onChange(following ? { planId: shown?.id } : {})}
      >
        {following ? <Link2 size={16} /> : <Link2Off size={16} />}
      </button>

      {/* While following this is READ-ONLY rather than blank. The service the
          dashboard resolved to is the single most useful thing on the bar at
          10:55 on a Sunday — "am I looking at the 9:30 or the 11:00" — and
          hiding it because the control is not editable answered the question
          for nobody. Same treatment the Event control already gets. */}
      <Control
        icon={<Clock size={17} />}
        display={time ? (clockOf(time) ?? time.name ?? 'Service') : plan ? 'First service' : '—'}
        caption={following ? (time?.name ?? 'Following the room') : (time?.name ?? 'Service time')}
        aria-label="Service time"
        disabled={following}
        value={config.timeId ?? FOLLOW}
        onChange={(e) =>
          onChange({
            ...config,
            timeId: e.target.value === FOLLOW ? undefined : e.target.value,
          })
        }
      >
        <option value={FOLLOW}>{plan ? 'First service' : '—'}</option>
        {plan?.times.map((t) => (
          <option key={t.id} value={t.id}>
            {[t.name, clockOf(t)].filter(Boolean).join(' · ')}
          </option>
        ))}
      </Control>

      {/* The room's own state, not this dashboard's — a producer looking at a
          rehearsal layout still needs to know the 9:30 went live. */}
      {live && (
        <span className="viewbar__live">
          <Radio size={13} aria-hidden /> LIVE
          {live.startedAt ? <LiveClock since={live.startedAt} /> : null}
        </span>
      )}

      {actions && <div className="viewbar__actions">{actions}</div>}
    </div>
  );
}

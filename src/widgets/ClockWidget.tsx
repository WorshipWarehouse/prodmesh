import { Clock } from 'lucide-react';
import { useNow } from '../lib/useNow';

// The time, large.
//
// On a stage or booth screen this is the single most-looked-at thing there is,
// and the alternative is a phone lit up in a dark room. It carries seconds
// because the people reading it are cueing against them — a clock that only
// says "10:42" is a clock you have to stop trusting a minute before you need
// it most.
//
// Deliberately the BROWSER's clock, not the server's. Every screen showing
// this is on the same LAN as the machines running the service and almost
// certainly the same NTP source, and the operator is really cueing against the
// wall clock they can see. A server-supplied time would be more defensible and
// less useful: the moment it disagreed with the wall by two seconds, nobody in
// the room would know which one to believe.

const TIME = { hour: 'numeric', minute: '2-digit', second: '2-digit' } as const;

/**
 * Split the formatted time from its AM/PM, so the digits can be one size and
 * the day period another — "11:17:38 AM" at one size is wide enough to wrap
 * out of a two-column cell, and a clock that wraps is unreadable.
 *
 * Via formatToParts rather than a regex because a 24-hour locale simply has no
 * dayPeriod part, and this then renders nothing extra instead of hunting for
 * an "AM" that was never going to be there.
 */
function split(now: Date) {
  const parts = new Intl.DateTimeFormat([], TIME).formatToParts(now);
  return {
    time: parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim(),
    period: parts.find((p) => p.type === 'dayPeriod')?.value ?? '',
  };
}

export function ClockWidget() {
  const now = new Date(useNow());
  const { time, period } = split(now);
  return (
    <div className="wgt wgt--clock">
      <div className="wgt__head">
        <span className="wgt__icon"><Clock size={16} /></span>
        {/* The date is the header, per UI_TEXT: a header carries data, not a
            label describing what is obviously a clock. */}
        <span className="wgt__title">
          {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
        </span>
      </div>
      <p className="wgt__value">
        {time}
        {period && <small> {period}</small>}
      </p>
    </div>
  );
}

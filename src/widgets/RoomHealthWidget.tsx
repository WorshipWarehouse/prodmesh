import { Activity } from 'lucide-react';
import { useTopic, roomTopic } from '../lib/stream';
import type { RoomHealth } from '../api';
import type { WidgetProps } from './types';

// A dot per integration this room has configured.
//
// The whole widget is one question — is anything broken right now — and the
// answer has to be readable in the half-second somebody glances at it. So the
// headline is a COUNT of what is wrong, not a count of what is right: "All
// good" reads as fine at a glance, and "2 down" reads as not-fine at the same
// glance, whereas "3/5" makes you do arithmetic before you know which it is.
//
// Only configured integrations appear. A room that does not stream has nothing
// to say about YouTube, and a permanent grey dot for it is the noise that
// teaches people to stop reading the dots.

const ORDER = { down: 0, unknown: 1, mock: 2, ok: 3 } as const;

export function RoomHealthWidget({ roomId }: WidgetProps) {
  const health = useTopic<RoomHealth>(roomTopic.health(roomId));

  // The first probe takes a moment (it is real requests to real machines).
  // Saying so beats an empty cell, which would read as "no integrations".
  if (!health) {
    return (
      <div className="wgt wgt--health">
        <div className="wgt__head">
          <span className="wgt__icon"><Activity size={16} /></span>
          <span className="wgt__title">Integrations</span>
        </div>
        <p className="wgt__detail">Checking…</p>
      </div>
    );
  }

  // Down first, then unexplained, then the ones that are fine — so the thing
  // you need to see is at the top left however few rows the cell has.
  const list = [...health.integrations].sort((a, b) => ORDER[a.state] - ORDER[b.state]);
  const down = list.filter((i) => i.state === 'down').length;
  const unknown = list.filter((i) => i.state === 'unknown').length;

  const summary = down
    ? `${down} down`
    : unknown
      ? `${unknown} not checked`
      : 'All good';
  const zone = down ? 'down' : unknown ? 'unknown' : 'ok';

  return (
    <div className={`wgt wgt--health wgt--health--${zone}`}>
      <div className="wgt__head">
        <span className="wgt__icon"><Activity size={16} /></span>
        <span className="wgt__title">Integrations</span>
        <span className="wgt__status">{summary}</span>
      </div>

      {/* A list rather than a table: a screen reader should read "Companion,
          not responding", which is the whole content of a coloured dot and is
          otherwise unavailable to anyone who cannot see the colour. */}
      <ul className="health">
        {list.map((i) => (
          <li key={i.id} className={`health__row health__row--${i.state}`}>
            <span className="health__dot" aria-hidden />
            <span className="health__name">{i.label}</span>
            <span className="health__state">{STATE_TEXT[i.state]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Said in full for a screen reader and hidden by CSS at narrow widths, where
// the colour and the position carry it. Never abbreviated in the markup: a
// dot with no text is not a status, it is a decoration.
const STATE_TEXT = {
  ok: 'Responding',
  down: 'Not responding',
  mock: 'Simulated',
  unknown: 'Not checked yet',
} as const;

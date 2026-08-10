import { Activity } from 'lucide-react';
import { Sparkline, type SparkBand } from '../components/Sparkline';
import { useTopic, roomTopic } from '../lib/stream';
import { useSeries } from '../lib/useSeries';
import { splZone } from '../lib/spl';
import type { SplState } from '../api';
import type { WidgetProps } from './types';

// Where the room's loudness has been going.
//
// A companion to Loudness, not a replacement: that one answers "are we too
// loud right now", which is a number and a limit. This answers "has this set
// been creeping up all morning", which is a shape and cannot be a number. Both
// on one dashboard is a reasonable thing to want, and either alone is a
// reasonable dashboard.

// The analyzer samples at 1 Hz. Drawn raw that is four minutes of noise in a
// 240px box; one sample every few seconds over a quarter of an hour is a line
// you can read across a room, and a quarter hour is about a worship set.
const EVERY_MS = 5_000;
const HISTORY = 180; // × EVERY_MS = 15 minutes

// The SAME 70–100 dB window the meter's bar spans, so the two widgets are
// directly comparable and the target/limit lines sit at a fixed height.
//
// Fixed rather than fitted to the data, which is a real trade: a quiet service
// occupies the lower third instead of filling the box. That is the point. An
// auto-fitted curve makes a half-decibel wobble look like a climb, and a
// widget whose job is "has this been creeping up" must not manufacture creep.
const WINDOW = { min: 70, max: 100 };

export function LoudnessTrendWidget({ roomId }: WidgetProps) {
  const spl = useTopic<SplState | null>(roomTopic.spl(roomId));
  // The topic publishes null when no analyzer is configured or it has stopped
  // answering, which is exactly when the curve should be dropped rather than
  // left standing as though it were still current.
  const history = useSeries(spl?.current, spl != null, { limit: HISTORY, everyMs: EVERY_MS });

  if (!spl) return null;

  const minutes = Math.round((history.length * EVERY_MS) / 60_000);
  const span = `last ${minutes < 1 ? 'minute' : `${minutes} min`}`;

  return (
    <div className={`wgt wgt--spl-trend ros-spl--${splZone(spl)}`}>
      <div className="wgt__head">
        <span className="wgt__icon"><Activity size={16} /></span>
        <span className="wgt__title">Loudness trend</span>
      </div>

      <p className="wgt__value">
        {spl.current.toFixed(1)} <small>dB</small>
      </p>

      {/* "on this screen" is not hedging — the curve is what this browser has
          watched since it was opened, and a reload starts it over. The
          service's real per-instance history is in the Show Report, which is
          what the server records for. */}
      <p className="wgt__detail">
        {history.length < 2 ? 'Recording…' : `${span} on this screen`}
      </p>

      {/* Only the thresholds this room actually configured. A band drawn at a
          number nobody agreed to is worse than no band. */}
      <Sparkline
        className="wgt__spark"
        points={history}
        bounds={WINDOW}
        bands={[
          spl.target != null ? { from: spl.target, tone: 'warn' as const } : null,
          spl.limit != null ? { from: spl.limit, tone: 'over' as const } : null,
        ].filter(Boolean) as SparkBand[]}
        label={`Loudness over the ${span}`}
      />
    </div>
  );
}

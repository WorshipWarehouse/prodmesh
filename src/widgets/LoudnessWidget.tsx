import { Volume2 } from 'lucide-react';
import { useTopic, roomTopic } from '../lib/stream';
import { splZone } from '../lib/spl';
import type { SplState } from '../api';
import type { WidgetProps } from './types';

// Live room loudness. Color tells the story at a glance: green under target,
// amber between target and limit, red over the limit.
//
// The most self-sufficient widget there is — it needs a room id and nothing
// else, which is why it was the honest first test of the registry contract.

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

export function LoudnessWidget({ roomId }: WidgetProps) {
  const spl = useTopic<SplState | null>(roomTopic.spl(roomId));
  if (!spl) return null;

  const zone = splZone(spl);
  // Meter bar spans a fixed 70–100 dB window (where worship services live).
  const pct = Math.min(100, Math.max(0, ((spl.current - 70) / 30) * 100));
  return (
    <div className={`wgt wgt--spl ros-spl--${zone}`}>
      <div className="wgt__head">
        <span className="wgt__icon"><Volume2 size={16} /></span>
        <span className="wgt__title">Loudness</span>
      </div>
      <p className="wgt__value">
        {spl.current.toFixed(1)} <small>dB</small>
      </p>
      <div className="ros-spl__bar">
        <div className="ros-spl__fill" style={{ width: `${pct}%` }} />
        {spl.target != null && (
          <div className="ros-spl__mark ros-spl__mark--target" style={{ left: `${((spl.target - 70) / 30) * 100}%` }} />
        )}
        {spl.limit != null && (
          <div className="ros-spl__mark ros-spl__mark--limit" style={{ left: `${((spl.limit - 70) / 30) * 100}%` }} />
        )}
      </div>
      <span className="wgt__detail">
        {spl.avg != null ? `avg ${spl.avg.toFixed(1)}` : 'avg —'}
        {' · '}
        {spl.peak != null ? `peak ${spl.peak.toFixed(1)}` : 'peak —'}
        {spl.target != null && ` · target ${spl.target}`}
      </span>
      {spl.ca && <CaGauge ca={spl.ca} />}
    </div>
  );
}

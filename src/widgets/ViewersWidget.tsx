import { useEffect, useRef, useState } from 'react';
import { Sparkline } from '../components/Sparkline';
import { useTopic, roomTopic } from '../lib/stream';
import type { StreamState } from '../api';
import type { WidgetProps } from './types';
import youtubeMark from '../assets/youtube-mark.svg';

// Live YouTube viewership. Like the loudness meter it needs only a room id —
// the server already knows which channel the room streams to.
//
// Renders nothing at all when the room has no YouTube configured (the topic
// never publishes) or when nothing is broadcasting. A "0 watching" tile on a
// Tuesday is noise, and worse, it looks like a fault.

/** How many samples the curve holds — about an hour at the 30s poll. */
const HISTORY = 120;

/**
 * The curve is OUR OWN recording, kept for as long as this screen has been
 * open.
 *
 * YouTube does not serve a viewer history: `concurrentViewers` is a single
 * number that exists only while the broadcast is live. The server records its
 * samples for the show report; this is the same idea in the browser, and it is
 * why the curve starts empty and fills in rather than appearing complete.
 */
function useViewerHistory(current: number | null | undefined, live: boolean) {
  const [points, setPoints] = useState<number[]>([]);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!live) {
      setPoints([]);
      last.current = null;
      return;
    }
    if (current == null || current === last.current) return;
    last.current = current;
    setPoints((p) => [...p, current].slice(-HISTORY));
  }, [current, live]);

  return points;
}

export function ViewersWidget({ roomId }: WidgetProps) {
  const stream = useTopic<StreamState | null>(roomTopic.youtube(roomId));
  const history = useViewerHistory(stream?.current, Boolean(stream?.live));

  if (!stream) return null;

  // Live but no number = the broadcaster hid the counter on YouTube's side.
  // Say so, rather than showing a zero somebody might repeat in a meeting.
  const hidden = stream.live && stream.current == null;
  if (!stream.live && stream.peak == null) return null;

  const detail = hidden
    ? 'Counter hidden on YouTube'
    : !stream.live
      ? 'Stream ended'
      : [
          stream.peak != null ? `peak ${stream.peak.toLocaleString()}` : null,
          stream.avg != null ? `avg ${stream.avg.toLocaleString()}` : null,
        ].filter(Boolean).join(' · ') || null;

  return (
    <div className="wgt wgt--viewers">
      <div className="wgt__head">
        {/* YouTube's own mark. Their brand guidelines permit it as attribution
            for data coming from the YouTube Data API, which is exactly what
            this number is. Vendored rather than hotlinked — a booth machine
            may have no route to the internet — and rendered as an <img> so it
            cannot inherit currentColor, because the mark must not be
            recoloured. */}
        <img
          className="wgt__brand"
          src={youtubeMark}
          alt=""
          title="Viewer counts from the YouTube Data API"
        />
        <span className="wgt__title">Current viewers</span>
        {stream.live && (
          <span className="wgt__status wgt__status--live">
            <span className="wgt__dot" aria-hidden /> Live
          </span>
        )}
      </div>

      <p className="wgt__value">
        {hidden || stream.current == null ? '—' : stream.current.toLocaleString()}
      </p>

      {detail && <p className="wgt__detail">{detail}</p>}

      {/* Fills whatever height is left, so the curve grows with the widget
          rather than sitting at one authored size. */}
      <Sparkline
        className="wgt__spark"
        points={history}
        label={`Viewers over the last ${history.length} samples`}
      />
    </div>
  );
}

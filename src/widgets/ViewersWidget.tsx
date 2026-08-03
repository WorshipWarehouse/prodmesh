import { Radio, Users } from 'lucide-react';
import { useTopic, roomTopic } from '../lib/stream';
import type { StreamState } from '../api';
import type { WidgetProps } from './types';

// Live YouTube viewership. Like the loudness meter, it needs only a room id —
// the server already knows which channel the room streams to.
//
// Renders nothing at all when the room has no YouTube configured (the topic
// never publishes) or when nothing is broadcasting. A "0 watching" tile on a
// Tuesday is noise, and worse, it looks like a fault.
export function ViewersWidget({ roomId }: WidgetProps) {
  const stream = useTopic<StreamState | null>(roomTopic.youtube(roomId));
  if (!stream) return null;

  // Live but no number = the broadcaster hid the counter on YouTube's side.
  // Say so, rather than showing a zero somebody might repeat in a meeting.
  const hidden = stream.live && stream.current == null;
  if (!stream.live && stream.peak == null) return null;

  return (
    <div className={`ros-viewers${stream.live ? ' ros-viewers--live' : ''}`}>
      <span className="ros-count__label">
        <Users size={13} /> Watching
        {stream.live && <span className="ros-viewers__dot"><Radio size={11} /></span>}
      </span>
      <span className="ros-viewers__count">
        {hidden ? '—' : stream.current != null ? stream.current.toLocaleString() : '—'}
      </span>
      <span className="ros-spl__stats">
        {hidden
          ? 'viewer count hidden on YouTube'
          : !stream.live
            ? 'stream ended'
            : [
                stream.peak != null ? `peak ${stream.peak.toLocaleString()}` : null,
                stream.avg != null ? `avg ${stream.avg.toLocaleString()}` : null,
              ].filter(Boolean).join(' · ') || 'live'}
      </span>
    </div>
  );
}

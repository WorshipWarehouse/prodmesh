import { Play } from 'lucide-react';
import { useTopic, roomTopic } from '../lib/stream';
import { usePlan } from './usePlan';
import { clock, liveShow, slideProgress } from './showPosition';
import type { ShowState, VideoState } from '../api';
import type { WidgetProps } from './types';

// What is happening and what is next — the two facts everyone in the building
// wants, sized to be read from across a room.
//
// The condensed relative of the run-of-show widget, and the reason there are
// two: an order of service is information-dense and belongs on a desk, while a
// stage screen or a multiview tile has room for exactly one line of each.

export function NowNextWidget({ roomId, config }: WidgetProps) {
  const show = useTopic<ShowState>(roomTopic.show(roomId));
  // Not scoped to the show: the most-watched video of the morning is the
  // pre-service loop, which plays with no show running at all.
  const video = useTopic<VideoState | null>(roomTopic.video(roomId));
  const { plan, planId, timeId } = usePlan(roomId, config);

  const live = liveShow(show, planId, timeId);

  const trackable = plan?.items.filter((i) => (i.type ?? 'item') !== 'header') ?? [];
  const idx = trackable.findIndex((i) => i.id === live?.current?.itemId);
  const current = idx >= 0 ? trackable[idx] : null;
  const next = idx >= 0 ? trackable[idx + 1] : trackable[0];

  // Nothing running, nothing scheduled and nothing playing is not a state
  // worth a card. The grid holds the space either way — the cell is positioned
  // by the layout, not by what is inside it.
  if (!live && !next && !video) return null;

  const slides = slideProgress(live);

  return (
    <div className="nownext">
      <div className="nownext__row nownext__row--now">
        <span className="nownext__label">Now</span>
        <span className="nownext__title">{current?.title ?? (live ? '—' : 'Not started')}</span>
      </div>

      {/* One progress row, never two. A playing video IS what the item is doing
          right now, so it replaces the slide count rather than sitting beside
          it — and ProPresenter reports a slide index during media playback, so
          without this rule you get two bars describing the same thing.

          Same bar as the Run of Show page draws, laid out for one line: this
          widget is 3×1 and a stacked label under it would cost the Next row.
          The empty label rather than a margin, because the rows above indent by
          .nownext__label's own width — copying that number into a margin
          resolves `em` against a different font size and landed 7px out. */}
      {video ? (
        <div className="nownext__row nownext__progress">
          <span className="nownext__label" aria-hidden />
          <span className="nownext__playing" aria-hidden><Play size={11} /></span>
          <div className="ros-progress__bar">
            <div
              className="ros-progress__fill ros-progress__fill--video"
              style={{ width: `${Math.min(100, ((video.seconds ?? 0) / video.duration) * 100)}%` }}
            />
          </div>
          <span className="nownext__slides mono">
            {clock(video.seconds ?? 0)} / {clock(video.duration)}
          </span>
        </div>
      ) : slides ? (
        <div className="nownext__row nownext__progress">
          <span className="nownext__label" aria-hidden />
          <div className="ros-progress__bar">
            <div
              className="ros-progress__fill"
              style={{ width: `${Math.min(100, (slides.at / slides.of) * 100)}%` }}
            />
          </div>
          <span className="nownext__slides mono">
            {slides.at}/{slides.of}
          </span>
        </div>
      ) : null}
      <div className="nownext__row">
        <span className="nownext__label">Next</span>
        <span className="nownext__title nownext__title--next">{next?.title ?? 'End of service'}</span>
      </div>
    </div>
  );
}

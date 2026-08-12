import { useTopic, roomTopic } from '../lib/stream';
import { usePlan } from './usePlan';
import { clock, liveShow, slideProgress, videoLeft } from './showPosition';
import type { ShowState, VideoState } from '../api';
import type { WidgetProps } from './types';

// How long until the thing on screen ends. One number, read across a control
// room at a glance.
//
// Built for the director calling cameras: what they need is not "slide 6 of 11"
// but "three left", because three left is when you stop taking a wide and get
// your next shot ready. Counting DOWN is the whole point — a position tells you
// where you are, a countdown tells you what to do.
//
// Same two sources and the same precedence as Now & Next, through the shared
// helpers in showPosition.ts: a playing video IS what the current item is
// doing, and ProPresenter reports a slide index straight through media
// playback, so without that rule this counts down slides nobody is looking at.

/** Slides. Amber is "get ready", red is "call it now". */
const SLIDE_WARN = 5;
const SLIDE_OVER = 2;

/** Seconds. The same two moments, at the pace a video runs out: half a minute
 *  to prepare a shot, ten seconds to be on it. Not specified by the request —
 *  chosen to match the slide thresholds and worth changing if they feel wrong
 *  in a real gallery. */
const VIDEO_WARN = 30;
const VIDEO_OVER = 10;

const zone = (left: number, warn: number, over: number) =>
  left <= over ? 'over' : left <= warn ? 'warn' : 'ok';

export function SlidesLeftWidget({ roomId, config }: WidgetProps) {
  const show = useTopic<ShowState>(roomTopic.show(roomId));
  // Not scoped to the show: the pre-service loop plays with nothing running,
  // and a director wants its countdown more than most.
  const video = useTopic<VideoState | null>(roomTopic.video(roomId));
  const { planId, timeId } = usePlan(roomId, config);

  const secondsLeft = videoLeft(video);
  const slides = slideProgress(liveShow(show, planId, timeId));

  // Nothing playing and nothing tracked. An empty cell, not a zero — a zero is
  // a number a director would act on.
  if (secondsLeft == null && !slides) return null;

  const playing = secondsLeft != null;
  const left = playing ? secondsLeft : slides!.of - slides!.at;
  const state = playing
    ? zone(left, VIDEO_WARN, VIDEO_OVER)
    : zone(left, SLIDE_WARN, SLIDE_OVER);

  return (
    <div className={`wgt wgt--left wgt--left--${state}`}>
      <div className="wgt__head">
        <span className="wgt__title">{playing ? 'Video left' : 'Slides left'}</span>
      </div>

      <p className="wgt__value">
        {playing ? clock(left) : left}
        {/* Colour is doing real work here, so it never works alone: a director
            who cannot separate amber from red still gets the word, and so does
            anyone on a screen reader. */}
        {state !== 'ok' && (
          <span className="sr-only"> — {state === 'over' ? 'ending now' : 'ending soon'}</span>
        )}
      </p>
    </div>
  );
}

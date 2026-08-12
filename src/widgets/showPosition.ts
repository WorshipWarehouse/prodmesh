import type { ShowState, VideoState } from '../api';

// Where the room is inside the thing it is currently doing.
//
// Extracted from NowNextWidget rather than copied into the second widget that
// wanted it. The precedence rule below is the kind that drifts silently: two
// copies stay identical right up until somebody fixes one of them, and the
// divergence shows up on a Sunday as two tiles disagreeing about what is on
// screen.

/** m:ss — a video is minutes long, and hours would be a wasted column. */
export const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * The show state, but only if it is THIS widget's service.
 *
 * A different service being live in the room says nothing about the one a
 * widget was placed for, and a pinned widget quietly tracking someone else's
 * service is worse than a blank one.
 */
export function liveShow(
  show: ShowState | undefined,
  planId?: string | null,
  timeId?: string | null,
): ShowState | null {
  if (!show?.active) return null;
  if (planId && show.planId !== planId) return null;
  if (timeId && show.timeId !== timeId) return null;
  return show;
}

/**
 * How far ProPresenter is through the current item, 1-based.
 *
 * Null unless PP has told us BOTH numbers: a bar with no denominator is a
 * decoration, and one left over from the previous item is a lie.
 */
export function slideProgress(show: ShowState | null): { at: number; of: number } | null {
  const cur = show?.current;
  if (cur?.slideIndex == null || cur.slideCount == null || cur.slideCount <= 0) return null;
  return { at: cur.slideIndex + 1, of: cur.slideCount };
}

/** Seconds left of a playing video. Null when nothing is playing — see
 *  VideoState: ProPresenter keeps a STOPPED video's identity forever, so the
 *  topic publishes null rather than a frozen counter. */
export function videoLeft(video: VideoState | null | undefined): number | null {
  if (!video || !(video.duration > 0)) return null;
  return Math.max(0, video.duration - (video.seconds ?? 0));
}

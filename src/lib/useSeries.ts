import { useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
//  A rolling series of what THIS SCREEN has watched happen.
//
//  Live values arrive over the stream as a single current number — "there are
//  427 people watching", "the room is at 84.2 dB". Neither carries a history,
//  because neither source has one to give: YouTube's concurrentViewers exists
//  only while a broadcast is live, and the analyzer reports the sample it just
//  took. The server records its own samples into SQLite for the Show Report;
//  this is the same idea in the browser, for a curve that has to be drawn now.
//
//  Which is why a curve starts empty and fills in rather than appearing
//  complete, and why reloading the page loses it. Say so wherever one is
//  drawn — a chart that silently covers "since you opened this tab" invites
//  being read as "this service".
// ─────────────────────────────────────────────────────────────────────────────

export interface SeriesOptions {
  /** How many points to keep. The window in time is this × the source's rate. */
  limit?: number;
  /**
   * Ignore samples arriving sooner than this after the last one kept.
   *
   * For a 1 Hz source a raw curve is several minutes of noise; thinning it to
   * one sample every few seconds is a shape you can read across a room. The
   * sample at the boundary is kept AS IS rather than averaging the ones
   * skipped: averaging decibels correctly means an energy average (Leq, see
   * server/splStore.js), and a second, subtly different loudness average in
   * the browser is worse than a slightly rougher line.
   */
  everyMs?: number;
}

/**
 * Record `current` while `live`, keeping the last `limit` samples.
 *
 * Resets to empty when `live` goes false, so a stale curve never outlives the
 * thing it described.
 */
export function useSeries(
  current: number | null | undefined,
  live: boolean,
  { limit = 120, everyMs = 0 }: SeriesOptions = {},
): number[] {
  const [points, setPoints] = useState<number[]>([]);
  const last = useRef<number | null>(null);
  const at = useRef(0);

  useEffect(() => {
    if (!live) {
      setPoints([]);
      last.current = null;
      at.current = 0;
      return;
    }
    // An unchanged value is the same sample seen twice — the stream re-sends
    // every topic's current value on reconnect, and a browser reconnects more
    // often than anything in a booth notices.
    if (current == null || current === last.current) return;
    const now = Date.now();
    if (everyMs && at.current && now - at.current < everyMs) return;
    last.current = current;
    at.current = now;
    setPoints((p) => [...p, current].slice(-limit));
  }, [current, live, limit, everyMs]);

  return points;
}

import { useEffect, useState } from 'react';

/**
 * Wall-clock time, re-read on each `intervalMs` boundary.
 *
 * Scheduled to the next boundary rather than on a fixed interval, because
 * setInterval only ever fires LATE — never early — so the error accumulates.
 * A 1000ms clock left running eventually shows the same second twice and then
 * skips one. Nobody notices that on a countdown; on a booth clock somebody is
 * cueing a service against it, and a second that stalls and then jumps is the
 * one thing a clock must not do.
 *
 * Returns epoch millis rather than a Date so it compares as a dependency —
 * a fresh Date is a new object every tick and re-runs every effect downstream.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let id: ReturnType<typeof setTimeout> | undefined;
    const at = (t: number) => intervalMs - (t % intervalMs);
    const tick = () => {
      const t = Date.now();
      setNow(t);
      id = setTimeout(tick, at(t));
    };
    id = setTimeout(tick, at(Date.now()));
    return () => clearTimeout(id);
  }, [intervalMs]);

  return now;
}

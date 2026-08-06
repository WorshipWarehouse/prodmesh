import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSeries } from './useSeries';

// A controllable clock: useSeries throttles on Date.now(), and faking timers
// wholesale interferes with testing-library's own waiting. Re-installed per
// test because the suite runs with restoreMocks.
let clock = 1_000_000;
const at = (t: number) => {
  clock = t;
};

beforeEach(() => {
  at(1_000_000);
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});

describe('useSeries', () => {
  it('records each new value, keeping the last `limit`', () => {
    const { result, rerender } = renderHook(({ v }) => useSeries(v, true, { limit: 3 }), {
      initialProps: { v: 1 as number | null },
    });
    for (const v of [2, 3, 4]) act(() => rerender({ v }));
    expect(result.current).toEqual([2, 3, 4]);
  });

  it('ignores a repeated value, which is the same sample seen twice', () => {
    // The stream re-sends every topic's current value on reconnect, and a
    // browser reconnects far more often than anyone in a booth notices. Without
    // this a quiet room draws a curve made entirely of reconnections.
    const { result, rerender } = renderHook(({ v }) => useSeries(v, true), {
      initialProps: { v: 5 as number | null },
    });
    act(() => rerender({ v: 5 }));
    act(() => rerender({ v: 6 }));
    act(() => rerender({ v: 6 }));
    expect(result.current).toEqual([5, 6]);
  });

  it('skips samples arriving inside the throttle window', () => {
    const { result, rerender } = renderHook(({ v }) => useSeries(v, true, { everyMs: 5000 }), {
      initialProps: { v: 80 as number | null },
    });
    at(1_001_000); // 1s later — too soon
    act(() => rerender({ v: 81 }));
    expect(result.current).toEqual([80]);

    at(1_006_000); // 6s after the kept sample
    act(() => rerender({ v: 82 }));
    expect(result.current).toEqual([80, 82]);
  });

  it('drops everything when the source stops, rather than leaving a stale curve', () => {
    const { result, rerender } = renderHook(({ v, live }) => useSeries(v, live), {
      initialProps: { v: 1 as number | null, live: true },
    });
    act(() => rerender({ v: 2, live: true }));
    expect(result.current).toEqual([1, 2]);

    act(() => rerender({ v: null, live: false }));
    expect(result.current).toEqual([]);

    // And starts over rather than resuming — the gap is real and a line drawn
    // across it would be a shape that never happened.
    act(() => rerender({ v: 9, live: true }));
    expect(result.current).toEqual([9]);
  });

  it('never records a null, which is "no reading" and not a zero', () => {
    const { result, rerender } = renderHook(({ v }) => useSeries(v, true), {
      initialProps: { v: null as number | null },
    });
    act(() => rerender({ v: null }));
    expect(result.current).toEqual([]);
  });
});

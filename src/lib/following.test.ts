import { describe, expect, it } from 'vitest';
import { currentServiceTime, resolveFollowing } from './following';
import type { PlanTime, ServicePlan, ShowState } from '../api';

// A two-service Sunday, which is the shape that broke: everything following
// the room sat on the 9:30 all morning, through the 11:00 and past the end of
// the day, because resolution never looked at the clock or at the live show.

const T = (h: number, m = 0) => `2026-08-09T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
const at = (h: number, m = 0) => Date.parse(T(h, m));

const time = (id: string, type: string, from: number, to: number | null): PlanTime => ({
  id, name: id, type, startsAt: T(from), endsAt: to == null ? null : T(to),
});

const REHEARSAL = time('reh', 'rehearsal', 8, 9);
const NINE_THIRTY = time('s930', 'service', 9, 10);
const ELEVEN = time('s1100', 'service', 11, 12);

const plan = (id: string, times: PlanTime[]): ServicePlan =>
  ({ id, times, items: [] }) as unknown as ServicePlan;

const SUNDAY = plan('p-sun', [REHEARSAL, NINE_THIRTY, ELEVEN]);

const liveShow = (planId: string, timeId: string): ShowState =>
  ({ active: true, planId, timeId }) as unknown as ShowState;

describe('currentServiceTime', () => {
  it('picks the service in progress, not the first of the day', () => {
    // THE BUG. At 11:20 the old resolution returned the 9:30 — it took
    // times.find(t => t.type === 'service'), which is a fixed answer.
    expect(currentServiceTime(SUNDAY.times, at(11, 20))?.id).toBe('s1100');
  });

  it('never returns a rehearsal', () => {
    // A rehearsal is not the service, even when it is the thing happening.
    expect(currentServiceTime(SUNDAY.times, at(8, 30))?.id).toBe('s930');
  });

  it('moves on once a service window has closed', () => {
    expect(currentServiceTime(SUNDAY.times, at(9, 45))?.id).toBe('s930');
    // 10:00 is the 9:30's endsAt — the window is half-open, so this is already
    // the next one. Between services you are prepping for the next, not
    // dwelling on the last.
    expect(currentServiceTime(SUNDAY.times, at(10, 30))?.id).toBe('s1100');
  });

  it('falls back to the next service start when nobody filled in an end time', () => {
    // Plenty of Planning Center plans have starts_at and no ends_at, so
    // back-to-back services still have to hand over cleanly.
    const open = [time('a', 'service', 9, null), time('b', 'service', 11, null)];
    expect(currentServiceTime(open, at(10, 30))?.id).toBe('a');
    expect(currentServiceTime(open, at(11, 5))?.id).toBe('b');
  });

  it('stays on the last service rather than blanking after it', () => {
    // There is no next thing today. Naming the one just finished beats an
    // empty bar during teardown.
    expect(currentServiceTime(SUNDAY.times, at(23))?.id).toBe('s1100');
  });

  it('points at the first service before the day starts', () => {
    expect(currentServiceTime(SUNDAY.times, at(6))?.id).toBe('s930');
  });

  it('handles a plan with no dated services at all', () => {
    const undated: PlanTime[] = [
      { id: 'x', name: null, type: 'service', startsAt: null, endsAt: null },
    ];
    expect(currentServiceTime(undated, at(10))?.id).toBe('x');
    expect(currentServiceTime([], at(10))).toBeNull();
  });
});

describe('resolveFollowing', () => {
  it('follows the service that is actually live — the reported bug', () => {
    // Sunday 2026-08-09, as it happened: the 11:00 went live and every
    // following dashboard carried on showing the 9:30. The room naming its own
    // service is the strongest signal there is, and nothing consulted it.
    const r = resolveFollowing([SUNDAY], liveShow('p-sun', 's1100'), at(9, 45));
    expect(r.time?.id).toBe('s1100');
  });

  it('lets the live show beat the clock in the other direction too', () => {
    // A service running long: at 11:05 the clock says the 11:00, but if the
    // 9:30 is still live then it is still the 9:30.
    const r = resolveFollowing([SUNDAY], liveShow('p-sun', 's930'), at(11, 5));
    expect(r.time?.id).toBe('s930');
  });

  it('follows the clock when nothing is live', () => {
    const r = resolveFollowing([SUNDAY], { active: false } as ShowState, at(11, 20));
    expect(r.plan?.id).toBe('p-sun');
    expect(r.time?.id).toBe('s1100');
  });

  it('prefers the live plan even when it is not the soonest', () => {
    // A plan added late, or a service running into the next one — the schedule
    // is exactly what is most likely to be wrong here.
    const other = plan('p-other', [time('o1', 'service', 14, 15)]);
    const r = resolveFollowing([other, SUNDAY], liveShow('p-sun', 's1100'), at(11, 30));
    expect(r.plan?.id).toBe('p-sun');
    expect(r.time?.id).toBe('s1100');
  });

  it('ignores a live show whose plan the room does not list', () => {
    // Falls back to the schedule rather than resolving to a plan it has no
    // times for, which would blank every widget.
    const r = resolveFollowing([SUNDAY], liveShow('p-gone', 'whatever'), at(9, 45));
    expect(r.plan?.id).toBe('p-sun');
    expect(r.time?.id).toBe('s930');
  });

  it('has nothing to say when the room has no plans', () => {
    expect(resolveFollowing([], null, at(10))).toEqual({ plan: null, time: null });
  });
});

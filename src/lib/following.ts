import type { PlanTime, ServicePlan, ShowState } from '../api';

// ─────────────────────────────────────────────────────────────────────────────
//  What "following the room" resolves to right now.
//
//  It used to mean the room's next PLAN and that plan's FIRST service time,
//  which is right until about 10:30 on a Sunday. The first service is not the
//  service — a two-service morning left every following dashboard showing the
//  9:30 through the 11:00 and past the end of the day, because nothing in the
//  resolution ever looked at the clock or at what the room was actually doing.
//
//  So following now asks, in order:
//
//    1. What is LIVE. A running show names its plan and service time outright;
//       no inference beats the room telling you.
//    2. What the clock says. Between services there is no show to ask, and the
//       honest answer is the one you are about to do, not the one you just did.
//
//  Shared by usePlan (what widgets render) and ViewBar (what the header says
//  they are rendering). Two copies of this rule would drift, and the drift
//  would look like the header lying about the widgets under it.
// ─────────────────────────────────────────────────────────────────────────────

const startMs = (t: PlanTime) => (t.startsAt ? new Date(t.startsAt).getTime() : null);

/**
 * The service time a following dashboard means at `now`.
 *
 * Windows are [start, end), where end is the time's own `endsAt` when Planning
 * Center supplied one and otherwise the next service's start — so back-to-back
 * services hand over cleanly even when nobody filled in an end time, which is
 * most of them.
 *
 * After the last service starts, it stays on the last service. There is no
 * next thing today, and jumping to a rehearsal or blanking the bar mid-teardown
 * would be worse than naming the one just finished.
 */
export function currentServiceTime(times: PlanTime[], now: number): PlanTime | null {
  const svc = times.filter((t) => t.type === 'service');
  const dated = svc.filter((t) => startMs(t) != null);
  // Nothing is scheduled with a time, so there is no clock answer to give.
  if (!dated.length) return svc[0] ?? times[0] ?? null;

  const running = dated.find((t, i) => {
    const start = startMs(t)!;
    const after = dated[i + 1];
    // The LAST service has no successor to hand over to, so its window runs to
    // Infinity unless it carries an end time. That is deliberate and matches
    // the fallback below: once the last service of the day has started, it
    // stays selected.
    const end = t.endsAt ? new Date(t.endsAt).getTime() : after ? startMs(after)! : Infinity;
    return now >= start && now < end;
  });
  if (running) return running;

  return dated.find((t) => startMs(t)! > now) ?? dated[dated.length - 1];
}

/**
 * The plan and service time a following dashboard means, given everything the
 * room knows. `plans` is the room's upcoming list, soonest first.
 *
 * A live show wins over the schedule even when its plan is not `plans[0]` —
 * that is the case where the schedule is most likely to be the thing that is
 * wrong (a plan added late, a service running long into the next one).
 */
export function resolveFollowing(
  plans: ServicePlan[],
  show: ShowState | null | undefined,
  now: number,
): { plan: ServicePlan | null; time: PlanTime | null } {
  const livePlan = show?.active ? plans.find((p) => p.id === show.planId) ?? null : null;
  const plan = livePlan ?? plans[0] ?? null;
  if (!plan) return { plan: null, time: null };

  // Only trust the live show's time against the plan it belongs to.
  const liveTime =
    livePlan && show?.timeId ? plan.times.find((t) => t.id === show.timeId) ?? null : null;

  return { plan, time: liveTime ?? currentServiceTime(plan.times, now) };
}

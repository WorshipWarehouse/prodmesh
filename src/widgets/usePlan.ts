import { getRoomPlan, getRoomService, type PlanTime, type ServicePlan, type ShowState } from '../api';
import { useQuery } from '../lib/useQuery';
import { planKey, roomServiceKey } from '../lib/keys';
import { resolveFollowing } from '../lib/following';
import { useTopic, roomTopic } from '../lib/stream';
import { useNow } from '../lib/useNow';
import type { WidgetConfig } from './types';

// Which service a widget is talking about.
//
// Every widget answers this the same way, and the answer is the difference
// between a screen that needs reconfiguring weekly and one that does not:
// pinned to a plan when a layout says so, otherwise following the room's next
// service on its own.
//
// The keys are the SHARED ones. A dashboard holding four widgets that all
// resolve the same plan makes one request, not four — and the page they sit on
// pays nothing extra either.

/** A rehearsal is not the service; the countdown that matters is the service's. */
export const firstServiceTime = (times: PlanTime[]): PlanTime | null =>
  times.find((t) => t.type === 'service') ?? times[0] ?? null;

// How often following re-asks the clock. A service boundary is the only thing
// that moves without something being pushed to us, and it is worth knowing
// about within a minute rather than at the 5-minute plan poll.
const FOLLOW_TICK_MS = 60_000;

export interface ResolvedPlan {
  plan: ServicePlan | null;
  planId: string | null;
  time: PlanTime | null;
  timeId: string | null;
}

export function usePlan(roomId: string, config: WidgetConfig): ResolvedPlan {
  const pinned = config.planId ?? null;

  const pinnedPlan = useQuery(
    pinned ? planKey(roomId, pinned) : null,
    () => getRoomPlan(roomId, pinned!),
    { staleMs: 10 * 60_000 },
  ).data?.plan;

  const service = useQuery(
    pinned ? null : roomServiceKey(roomId),
    () => getRoomService(roomId),
    { pollMs: 5 * 60_000, staleMs: 5 * 60_000 },
  ).data;

  // Following tracks what the room is DOING, so it needs the room's live show
  // and a clock — see lib/following. Both are cheap: the topic refcounts
  // across every widget on the screen, and the tick is once a minute.
  const show = useTopic<ShowState>(roomTopic.show(roomId));
  const now = useNow(FOLLOW_TICK_MS);
  const followed = pinned ? null : resolveFollowing(service?.plans ?? [], show, now);

  /**
   * `/api/rooms/:id/service` carries ITEMS for its FIRST plan only — see
   * routes/events.js, where that was all the preview needed and fetching every
   * plan's order of service on a 30-second poll would triple the Planning
   * Center load for nothing.
   *
   * Following can legitimately resolve to a different one: the live show's
   * plan is whichever the room actually started, not whichever is soonest. So
   * a followed plan that is not plans[0] arrives with an EMPTY order of
   * service, and every widget reading plan.items renders as though the service
   * had nothing in it. Fetched in full here, on the SHARED key — the same
   * request the Run of Show page already makes, so a dashboard beside it pays
   * nothing.
   */
  const listed = followed?.plan ?? null;
  const partial = Boolean(listed && listed.id !== service?.plans[0]?.id);
  const fullPlan = useQuery(
    partial && listed ? planKey(roomId, listed.id) : null,
    () => getRoomPlan(roomId, listed!.id),
    { staleMs: 10 * 60_000 },
  ).data?.plan;

  // The listed copy stands in until the full one lands: its TIMES are complete
  // either way, so the countdown keeps working rather than blanking.
  const followedPlan = (partial ? fullPlan ?? listed : listed) ?? null;
  const plan = (pinned ? pinnedPlan : followedPlan) ?? null;

  // An explicit timeId always wins. Otherwise: a followed dashboard takes the
  // service the room is on, and a PINNED one takes the first — which is what
  // its dropdown says it will do ("First service"), and someone who pinned a
  // plan for a rehearsal layout chose that.
  //
  // Resolved by ID rather than by holding the object, because the plan under
  // it may have just been swapped for the fully-fetched copy.
  const wantTimeId = config.timeId ?? (pinned ? null : followed?.time?.id ?? null);
  const resolveTime = (p: ServicePlan | null): PlanTime | null => {
    if (!p) return null;
    const named = wantTimeId ? p.times.find((t) => t.id === wantTimeId) : undefined;
    if (named) return named;
    // A pinned plan with no explicit time means its FIRST service, which is
    // what its dropdown offers. A followed one has already been told which
    // service the room is on, so falling back would only ever be wrong.
    return pinned ? firstServiceTime(p.times) : null;
  };
  const time = resolveTime(plan);

  return {
    plan,
    planId: plan?.id ?? null,
    time: time ?? null,
    timeId: config.timeId ?? time?.id ?? null,
  };
}

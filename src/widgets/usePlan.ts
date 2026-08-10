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

  const plan = (pinned ? pinnedPlan : followed?.plan) ?? null;
  // An explicit timeId always wins. Otherwise: a followed dashboard takes the
  // service the room is on, and a PINNED one takes the first — which is what
  // its dropdown says it will do ("First service"), and someone who pinned a
  // plan for a rehearsal layout chose that.
  const time = plan
    ? (config.timeId ? plan.times.find((t) => t.id === config.timeId) : null) ??
      (pinned ? firstServiceTime(plan.times) : followed?.time ?? null)
    : null;

  return {
    plan,
    planId: plan?.id ?? null,
    time: time ?? null,
    timeId: config.timeId ?? time?.id ?? null,
  };
}

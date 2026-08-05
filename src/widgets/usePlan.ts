import { getRoomPlan, getRoomService, type PlanTime, type ServicePlan } from '../api';
import { useQuery } from '../lib/useQuery';
import { planKey, roomServiceKey } from '../lib/keys';
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

  const nextPlan = useQuery(
    pinned ? null : roomServiceKey(roomId),
    () => getRoomService(roomId),
    { pollMs: 5 * 60_000, staleMs: 5 * 60_000 },
  ).data?.plans[0];

  const plan = (pinned ? pinnedPlan : nextPlan) ?? null;
  const time = plan
    ? (config.timeId ? plan.times.find((t) => t.id === config.timeId) : null) ??
      firstServiceTime(plan.times)
    : null;

  return {
    plan,
    planId: plan?.id ?? null,
    time: time ?? null,
    timeId: config.timeId ?? time?.id ?? null,
  };
}

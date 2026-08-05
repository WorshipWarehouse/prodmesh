import type { SplState } from '../api';

/**
 * Which band the room is in: under target, between target and limit, or over.
 *
 * Shared rather than repeated because two widgets now colour themselves by it,
 * and a meter reading amber next to a trend reading green is the kind of
 * disagreement nobody debugs — they just stop trusting both. The class names
 * `ros-spl--ok|warn|over` are styled once in show.css.
 *
 * A room with neither a target nor a limit configured is always 'ok': the
 * numbers are a policy this building has not set, and inventing one would
 * paint a red meter over a mix nobody has complained about.
 */
export type SplZone = 'ok' | 'warn' | 'over';

export function splZone(spl: Pick<SplState, 'current' | 'target' | 'limit'>): SplZone {
  if (spl.limit != null && spl.current >= spl.limit) return 'over';
  if (spl.target != null && spl.current >= spl.target) return 'warn';
  return 'ok';
}

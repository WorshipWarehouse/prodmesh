// ─────────────────────────────────────────────────────────────────────────────
//  AUTOSTART LOGIC  —  pure helpers for ProPresenter-driven show automation.
//
//  The trigger is the OPERATOR, not the clock: when ProPresenter lands on the
//  configured start item, the show starts; when the last slide of the
//  configured end item shows, the show completes. "Pre-Service Slides" can sit
//  active for 30 minutes between services without tripping anything, because
//  only a transition INTO the start item arms a start (edge-triggered).
// ─────────────────────────────────────────────────────────────────────────────

/** The clock window in which autostart watches PP for an event. */
export function armWindow(times, beforeMs = 2 * 60 * 60 * 1000, afterMs = 60 * 60 * 1000) {
  const svc = times.filter((t) => t.type === 'service' && t.startsAt);
  if (svc.length === 0) return null;
  const starts = svc.map((t) => new Date(t.startsAt).getTime());
  return { from: Math.min(...starts) - beforeMs, to: Math.max(...starts) + afterMs };
}

/**
 * Which service time a triggered start belongs to: the nearest by clock,
 * skipping times whose show already completed (a 10:58 trigger must start the
 * 11:00, not reopen the finished 9:00). Null when every time is done.
 */
export function pickAutostartTime(times, now, isCompleted) {
  const candidates = times
    .filter((t) => t.type === 'service' && t.startsAt && !isCompleted(t.id))
    .map((t) => ({ id: t.id, dist: Math.abs(new Date(t.startsAt).getTime() - now) }))
    .sort((a, b) => a.dist - b.dist);
  return candidates[0]?.id ?? null;
}

/**
 * Edge-triggered start detection. `prevItemId` is the mapped PC item from the
 * previous poll (null = no baseline yet — never trigger on the first
 * observation, so a server reboot mid-worship doesn't restart a show the
 * operator ended on purpose).
 */
export function shouldAutostart(config, prevItemId, itemId) {
  return Boolean(
    config?.startItemId &&
      itemId === config.startItemId &&
      prevItemId !== null &&
      prevItemId !== itemId,
  );
}

/** Show is on the configured end item's LAST slide → complete the show. */
export function shouldAutoComplete(config, current) {
  return Boolean(
    config?.endItemId &&
      current?.itemId === config.endItemId &&
      current.slideIndex != null &&
      current.slideCount != null &&
      current.slideCount > 0 &&
      current.slideIndex >= current.slideCount - 1,
  );
}

import { useState } from 'react';
import { PermissionError, requestAuth, type ShowState } from '../api';
import { useTopic, roomTopic } from './stream';
import { useCan, useIdentity } from './identity';

// ─────────────────────────────────────────────────────────────────────────────
//  Operating a show, from anywhere.
//
//  Shared by the Run of Show PAGE and the run-of-show WIDGET. Two copies of
//  "hold the optimistic result until the push arrives" would diverge, and the
//  divergence is invisible until a Sunday when one of them appears to do
//  nothing.
// ─────────────────────────────────────────────────────────────────────────────

export const OPERATE = 'shows.operate';
export const OPERATE_LABEL = 'Operate shows';

/** What went wrong, in words an operator can act on. */
export function failureText(err: unknown): string {
  if (err instanceof PermissionError) {
    return err.authenticated
      ? 'Your account cannot operate shows.'
      : 'Log in to operate shows.';
  }
  return err instanceof Error ? err.message : String(err);
}

export function useShowActions(roomId: string) {
  // The server is the source of truth; this just renders its state.
  const liveShow = useTopic<ShowState>(roomTopic.show(roomId));

  // Start/End return the new state too. The push normally beats the response
  // (the server publishes before it replies), but if the stream is mid-
  // reconnect it won't — and Start Show appearing to do nothing is the worst
  // possible moment for that. So an action's result is held until the next
  // push arrives, identified by `liveShow` becoming a different object.
  const [acted, setActed] = useState<{ from: unknown; state: ShowState } | null>(null);
  const state: ShowState =
    acted && acted.from === liveShow ? acted.state : (liveShow ?? { active: false });

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const canOperate = useCan(OPERATE);
  const loggedIn = Boolean(useIdentity()?.authenticated);

  /**
   * Run an action, holding its result and surfacing its refusal.
   *
   * "The stream reconciles" is true of a state RACE and of nothing else. A
   * refusal — no permission, a show already live in the room, a rejected plan
   * id — produces no push at all, so swallowing it leaves the button looking
   * dead and the operator with nothing to act on mid-service.
   */
  const act = async (fn: () => Promise<ShowState>): Promise<ShowState | null> => {
    setBusy(true);
    setFailure(null);
    try {
      const next = await fn();
      // Only hold a state that IS one. Everything downstream reads
      // `state.active` unguarded, so holding a null or an empty body — a 200
      // with nothing in it, a proxy that ate the response — turns the End
      // Show button into a white screen mid-service. Declining to hold costs
      // only the optimistic flicker; the stream reconciles a moment later.
      if (next && typeof next === 'object') setActed({ from: liveShow, state: next });
      return next;
    } catch (err) {
      setFailure(failureText(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  // Shown wherever the show controls would be. Someone who is not logged in
  // gets the way forward, not just the wall: the shell's own dialog, opened by
  // the same event a refused request fires.
  const notPermitted = loggedIn ? (
    <span className="ros-track__denied">Your account cannot operate shows.</span>
  ) : (
    <>
      <span className="ros-track__denied">Read-only.</span>
      <button className="btn btn--sm" onClick={() => requestAuth(OPERATE, OPERATE_LABEL)}>
        Log in to operate
      </button>
    </>
  );

  return { liveShow, state, busy, failure, act, canOperate, loggedIn, notPermitted };
}

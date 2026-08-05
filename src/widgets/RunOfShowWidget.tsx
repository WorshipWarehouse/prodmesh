import { ChevronLeft, ChevronRight, MonitorOff, Pause, Play, Radio, Square } from 'lucide-react';
import { endShow, setShowCurrent, startShow } from '../api';
import { OrderOfService } from '../components/OrderOfService';
import { useShowActions } from '../lib/showActions';
import { usePlan } from './usePlan';
import type { WidgetProps } from './types';

// ─────────────────────────────────────────────────────────────────────────────
//  Run of Show, placeable.
//
//  ADR 0010 said the show controls would stay a page component because "no
//  dashboard would place it". That was wrong: a producer's dashboard is
//  exactly where you want Next under your thumb. What made it safe to place is
//  the permission gating — the widget can offer the controls to whoever may
//  use them and say so plainly to whoever may not.
//
//  Every piece of that behaviour is shared with the page through
//  useShowActions rather than copied: the optimistic hold, the refusal
//  message, the read-only affordance.
//
//  Dashboard only. It takes actions, and a display is DEFINED as
//  non-interactive — see NowNextWidget for the screen-on-a-wall version.
// ─────────────────────────────────────────────────────────────────────────────

export function RunOfShowWidget({ roomId, config }: WidgetProps) {
  const { plan, planId, timeId } = usePlan(roomId, config);
  const { state, busy, failure, act, canOperate, notPermitted } = useShowActions(roomId);

  const isThisShow =
    state.active && (!planId || state.planId === planId) && (!timeId || state.timeId === timeId);
  const isOtherShow = state.active && !isThisShow;

  const trackable = plan?.items.filter((i) => (i.type ?? 'item') !== 'header') ?? [];
  const cur = isThisShow ? state.current : null;
  const currentId = cur?.itemId ?? null;
  const idx = trackable.findIndex((i) => i.id === currentId);
  const follow = isThisShow ? Boolean(state.follow) : false;
  const ppConnected = isThisShow ? state.ppConnected : null;

  const pick = (itemId: string) => act(() => setShowCurrent(roomId, { itemId }));
  const step = (delta: number) => {
    const n = idx < 0 ? (delta > 0 ? 0 : -1) : idx + delta;
    if (n >= 0 && n < trackable.length) pick(trackable[n].id);
  };

  if (!plan) return null;

  return (
    <div className="rosw">
      {isOtherShow ? (
        <p className="rosw__status rosw__status--off">
          <Radio size={14} /> Another show is live in this room
        </p>
      ) : !isThisShow ? (
        <div className="rosw__start">
          <span className="rosw__status rosw__status--idle">No show running</span>
          {canOperate ? (
            <button
              className="btn btn--primary btn--sm"
              disabled={busy || !planId}
              onClick={() => act(() => startShow(roomId, planId!, timeId ?? 'default'))}
            >
              <Play size={14} /> Start Show
            </button>
          ) : notPermitted}
        </div>
      ) : (
        <>
          <p
            className={`rosw__status rosw__status--${
              ppConnected == null ? 'idle' : !ppConnected ? 'off' : follow ? 'follow' : 'manual'
            }`}
          >
            {ppConnected == null ? (
              'connecting to ProPresenter…'
            ) : !ppConnected ? (
              <><MonitorOff size={13} /> ProPresenter offline</>
            ) : follow ? (
              <><Radio size={13} /> Following ProPresenter</>
            ) : (
              <><Pause size={13} /> Manual override</>
            )}
          </p>

          {cur?.slideCount != null && cur?.slideIndex != null && (
            <div className="ros-progress">
              <div className="ros-progress__bar">
                <div
                  className="ros-progress__fill"
                  style={{ width: `${Math.min(100, ((cur.slideIndex + 1) / cur.slideCount) * 100)}%` }}
                />
              </div>
              <span className="ros-progress__label">Slide {cur.slideIndex + 1} / {cur.slideCount}</span>
            </div>
          )}

          {canOperate ? (
            <div className="rosw__buttons">
              <button className="btn btn--sm" disabled={busy || idx <= 0} onClick={() => step(-1)}>
                <ChevronLeft size={15} /> Prev
              </button>
              <button
                className="btn btn--primary btn--sm"
                disabled={busy || (idx >= 0 && idx >= trackable.length - 1)}
                onClick={() => step(1)}
              >
                Next <ChevronRight size={15} />
              </button>
              <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => act(() => endShow(roomId))}>
                <Square size={12} /> End
              </button>
            </div>
          ) : (
            <div className="rosw__buttons">{notPermitted}</div>
          )}
        </>
      )}

      {failure && <p className="ros-track__failure" role="alert">{failure}</p>}

      {/* The list scrolls inside the widget rather than growing it — a
          placement is 2x3 cells whatever the service holds, and a 40-item
          order of service must not push its neighbours off the grid.
          onSelect is the read-only switch: absent, items are not clickable. */}
      <div className="rosw__list">
        <OrderOfService
          items={plan.items}
          currentId={currentId}
          onSelect={isThisShow && canOperate ? pick : undefined}
        />
      </div>
    </div>
  );
}

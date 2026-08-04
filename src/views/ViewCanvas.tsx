import type { CSSProperties, ReactNode } from 'react';
import { PlacedWidget } from './PlacedWidget';
import { rowCount, type Grid, type Placement } from '../lib/gridLayout';
import type { WidgetConfig } from '../widgets/types';
import type { View, ViewPlacement } from '../api';

// ─────────────────────────────────────────────────────────────────────────────
//  The grid a View is drawn on.
//
//  ONE renderer for three surfaces — the dashboard page, the display page and
//  the editor's canvas. The editor passing `chrome` per cell is the only
//  difference, which is what makes it impossible for the editor's preview to
//  drift from what a screen in the building actually shows.
//
//  Not the same grid as `.widgets` (styles/widgets.css). That one is a FLOW
//  grid: cards in a row that reflows to one column below 880px. This is a
//  fixed 2D canvas where a widget occupies (x, y, w, h) and nothing reflows,
//  because "2 wide by 3 high" is meaningless if it becomes 12 wide on a phone
//  and a display's 3×3 must never move at all.
// ─────────────────────────────────────────────────────────────────────────────

export function ViewCanvas({
  view,
  grid,
  config,
  chromeFor,
  overlay,
  className = '',
  canvasRef,
  onPointerDown,
}: {
  view: View;
  grid: Grid;
  /** Context every widget inherits — the menubar's plan/time on a dashboard. */
  config: WidgetConfig;
  /** Editor furniture for one cell. Absent when the view is live. */
  chromeFor?: (placement: ViewPlacement) => ReactNode;
  /** The drag ghost, drawn over the grid in the editor. */
  overlay?: ReactNode;
  className?: string;
  canvasRef?: React.Ref<HTMLDivElement>;
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
}) {
  const rows = rowCount(grid, view.widgets as Placement[]);
  const style = {
    '--view-columns': grid.columns,
    '--view-rows': rows,
  } as CSSProperties;

  return (
    <div
      ref={canvasRef}
      className={`viewgrid${grid.maxRows != null ? ' viewgrid--fixed' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      onPointerDown={onPointerDown}
    >
      {view.widgets.map((placement) => (
        <PlacedWidget
          key={placement.id}
          roomId={view.roomId}
          placement={placement}
          config={mergeConfig(placement, config)}
          chrome={chromeFor?.(placement)}
        />
      ))}
      {overlay}
    </div>
  );
}

/**
 * The view's context wins over the placement's own.
 *
 * The menubar is the single source of "which service are we looking at", so
 * picking one there re-scopes every widget at once. Its default state is
 * "Follow the room" — an empty config — and that is what lets a lobby screen
 * go a year without being reconfigured: each widget falls through to the room's
 * next service on its own.
 */
function mergeConfig(placement: ViewPlacement, config: WidgetConfig): WidgetConfig {
  return config.planId ? { ...placement.config, ...config } : placement.config;
}

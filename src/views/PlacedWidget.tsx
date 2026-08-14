import type { CSSProperties, ReactNode } from 'react';
import { PackageOpen } from 'lucide-react';
import { widgetRegistry, isWidgetType } from '../widgets/registry';
import type { WidgetConfig } from '../widgets/types';
import { IntegrationBrand } from '../components/IntegrationBrand';
import type { ViewPlacement } from '../api';

// One cell of a View's grid.
//
// The cell is positioned here and the widget inside it knows nothing about
// where it is — which is the property that lets the same component render on
// Run of Show, on a dashboard and on a 3×3 display with no prop for it.

/**
 * A placement naming a widget this build doesn't have.
 *
 * It holds the slot rather than disappearing. Dropping it would REFLOW the
 * grid — every other widget shuffles up into the gap, rearranging a layout
 * somebody arranged by hand, on a screen they are probably looking at during a
 * service. A grey card is a much smaller lie. (Same reason the server returns
 * an unknown type verbatim on read while refusing to store one.)
 */
function UnknownWidget({ type }: { type: string }) {
  return (
    <div className="viewcell__unknown">
      <PackageOpen size={18} aria-hidden />
      <p>
        <strong>{type}</strong>
        <small>Not available in this version</small>
      </p>
    </div>
  );
}

export function PlacedWidget({
  roomId,
  placement,
  config,
  chrome,
  className = '',
}: {
  /** Views are room-scoped, so every placement takes the view's room. */
  roomId: string;
  placement: ViewPlacement;
  /** The view's context, merged over the placement's own. */
  config: WidgetConfig;
  /** Editor furniture — a drag handle, a remove button. Absent when live. */
  chrome?: ReactNode;
  className?: string;
}) {
  const def = isWidgetType(placement.type) ? widgetRegistry[placement.type] : null;
  const Component = def?.component;
  // The widget remains responsible for its own layout. The canvas scales that
  // existing design to the chosen cell without changing the widget itself.
  // Do not make a one-cell placement illegibly small just because an older
  // default happened to start at 2×3: the widened inner layout still fits the
  // cell, while this readability floor lets text, controls and lists use the
  // space the operator chose.
  const authoredScale = def
    ? Math.min(placement.w / def.size.w, placement.h / def.size.h)
    : 1;
  const scale = Math.max(0.75, authoredScale);

  return (
    <div
      className={`viewcell${def ? '' : ' viewcell--unknown'}${className ? ` ${className}` : ''}`}
      style={{
        gridColumn: `${placement.x + 1} / span ${placement.w}`,
        gridRow: `${placement.y + 1} / span ${placement.h}`,
      }}
      data-widget={placement.type}
    >
      {chrome}
      {!chrome && def && (
        <header className="viewcell__widget-head">
          <IntegrationBrand integration={def.integration ?? 'prodmesh'} />
          <span>{def.title}</span>
        </header>
      )}
      {/* A widget with nothing to say renders null — LoudnessWidget with no
          SPL, ViewersWidget off-air. In a flow grid that card simply vanishes;
          on a fixed canvas its cell stays, and a blank rectangle reads as a
          fault. `data-title` + `:empty` in CSS labels it instead, with no way
          for the widget to have to know it is on a canvas. */}
      <div
        className={`viewcell__body${scale !== 1 ? ' viewcell__body--scale-fit' : ''}`}
        data-title={def?.title ?? placement.type}
        style={{ '--widget-scale': scale } as CSSProperties}
      >
        {Component ? (
          <Component roomId={roomId} config={config} />
        ) : (
          <UnknownWidget type={placement.type} />
        )}
      </div>
    </div>
  );
}

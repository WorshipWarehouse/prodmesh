import { useMemo, useRef, useState } from 'react';
import { GripVertical, X } from 'lucide-react';
import { ViewCanvas } from './ViewCanvas';
import { WidgetPalette, paletteFor } from './WidgetPalette';
import { useGridDrag, type Cell } from './useGridDrag';
import { findFirstFit, isFree, occupancy, rowCount, type Grid } from '../lib/gridLayout';
import { widgetRegistry, isWidgetType } from '../widgets/registry';
import type { View, ViewPlacement } from '../api';

// ─────────────────────────────────────────────────────────────────────────────
//  Arranging a view.
//
//  The canvas is the SAME ViewCanvas the live page renders, with `chrome`
//  passed per cell. One renderer means the editor's preview cannot drift from
//  what a screen in the building actually shows — which is the failure mode of
//  every layout editor that draws its own approximation.
//
//  Widgets stay LIVE while you arrange them: a ticking countdown, a real SPL
//  meter. Only the header strip is interactive, and the body is inert via CSS.
//  Solving that with a prop would have meant widening WidgetProps, and that
//  contract being narrow is the whole reason a layout can be data.
// ─────────────────────────────────────────────────────────────────────────────

const ARROWS: Record<string, Cell> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

export function ViewEditor({
  view,
  grid,
  onChange,
}: {
  view: View;
  grid: Grid;
  onChange: (widgets: ViewPlacement[]) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  // Which card is in keyboard "grab" mode, and what the last move announced.
  const [grabbed, setGrabbed] = useState<string | null>(null);
  const [announcement, setAnnounce] = useState('');

  const placements = view.widgets;

  // ONE row count for the canvas and the pointer maths. A dashboard normally
  // sizes to its content, which would leave the editor dividing by rows the
  // browser never drew — the drop then lands wherever that arithmetic says,
  // which is not where the cursor is. A row of headroom past the deepest
  // widget is what lets a dashboard be extended by dropping below it.
  const rows =
    grid.maxRows ?? Math.max(rowCount(grid, placements) + 1, grid.defaultRows ?? 1);
  const palette = useMemo(() => paletteFor(view.kind, grid, placements), [view.kind, grid, placements]);

  const place = (type: string, at: Cell) => {
    const def = isWidgetType(type) ? widgetRegistry[type] : null;
    if (!def) return;
    onChange([
      ...placements,
      { id: `new-${type}-${placements.length}`, type, ...at, ...def.size, config: {} },
    ]);
  };

  const moveTo = (id: string, at: Cell) =>
    onChange(placements.map((p) => (p.id === id ? { ...p, ...at } : p)));

  const remove = (id: string) => {
    onChange(placements.filter((p) => p.id !== id));
    if (grabbed === id) setGrabbed(null);
  };

  const { drag, addHandlers, moveHandlers } = useGridDrag({
    canvas,
    grid,
    placements,
    onAdd: place,
    onMove: moveTo,
  });

  const addFromPalette = (type: string) => {
    const def = isWidgetType(type) ? widgetRegistry[type] : null;
    const at = def && findFirstFit(grid, placements, def.size);
    if (!at || !def) return;
    place(type, at);
    setAnnounce(`${def.title} added at column ${at.x + 1}, row ${at.y + 1}.`);
  };

  /** Arrow-key movement for the grabbed card. Refuses rather than shoves. */
  const nudge = (placement: ViewPlacement, delta: Cell) => {
    const next = { x: placement.x + delta.x, y: placement.y + delta.y };
    const title = isWidgetType(placement.type) ? widgetRegistry[placement.type].title : placement.type;
    const cells = occupancy(placements, placement.id);
    if (!isFree(grid, cells, { ...next, w: placement.w, h: placement.h })) {
      setAnnounce(`${title} cannot move there.`);
      return;
    }
    moveTo(placement.id, next);
    setAnnounce(`${title} at column ${next.x + 1}, row ${next.y + 1}.`);
  };

  const chromeFor = (placement: ViewPlacement) => {
    const title = isWidgetType(placement.type) ? widgetRegistry[placement.type].title : placement.type;
    const held = grabbed === placement.id;
    return (
      <div className="viewcell__chrome">
        <button
          type="button"
          className="viewcell__grip"
          aria-pressed={held}
          aria-label={`Move ${title}, column ${placement.x + 1}, row ${placement.y + 1}`}
          title="Drag to move, or press Enter and use the arrow keys"
          {...moveHandlers(placement)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setGrabbed(held ? null : placement.id);
              setAnnounce(held ? `${title} placed.` : `${title} grabbed. Use the arrow keys.`);
            } else if (e.key === 'Escape' && held) {
              setGrabbed(null);
              setAnnounce(`${title} placed.`);
            } else if (held && ARROWS[e.key]) {
              e.preventDefault();
              nudge(placement, ARROWS[e.key]);
            }
          }}
        >
          <GripVertical size={14} aria-hidden />
          <span className="viewcell__name">{title}</span>
        </button>
        <button
          type="button"
          className="viewcell__remove"
          aria-label={`Remove ${title}`}
          onClick={() => remove(placement.id)}
        >
          <X size={14} />
        </button>
      </div>
    );
  };

  // The drop shadow. Drawn inside the grid so it lands on real cells rather
  // than on a pixel guess about where they are.
  const ghost = drag.kind !== 'none' && drag.at && (
    <div
      className={`viewghost${drag.ok ? '' : ' viewghost--blocked'}`}
      style={{
        gridColumn: `${drag.at.x + 1} / span ${drag.size.w}`,
        gridRow: `${drag.at.y + 1} / span ${drag.size.h}`,
      }}
      aria-hidden
    />
  );

  return (
    <div className="vieweditor">
      <WidgetPalette entries={palette} onAdd={addFromPalette} dragHandlers={addHandlers} />

      <div className="vieweditor__canvas">
        {view.kind === 'display' ? (
          <div className="viewframe">
            <ViewCanvas
              view={{ ...view, widgets: placements }}
              grid={grid}
              config={{}}
              rows={rows}
              canvasRef={canvas}
              className="viewgrid--editing"
              chromeFor={chromeFor}
              overlay={ghost}
            />
          </div>
        ) : (
          <ViewCanvas
            view={{ ...view, widgets: placements }}
            grid={grid}
            config={{}}
            rows={rows}
            canvasRef={canvas}
            className="viewgrid--editing"
            chromeFor={chromeFor}
            overlay={ghost}
          />
        )}
        {placements.length === 0 && (
          <p className="vieweditor__hint">Add a widget from the list, or drag one onto the grid.</p>
        )}
      </div>

      {/* Every keyboard move says where it landed, or that it refused. */}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </div>
  );
}

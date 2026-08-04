import { Plus } from 'lucide-react';
import { widgetRegistry, widgetTypes } from '../widgets/registry';
import { widgetAllowedOn, widgetIsUnique, type WidgetType } from '../widgets/types';
import { findFirstFit, type Grid, type ViewKind } from '../lib/gridLayout';
import type { ViewPlacement } from '../api';

// What can go on this view, and whether there is anywhere to put it.
//
// Every entry has an Add button as well as being a drag source. That is not a
// fallback — it is the fastest path with a mouse, the only path from a
// keyboard, and the reason the whole editor is testable in jsdom before a
// single pointer event exists.

export interface PaletteEntry {
  type: WidgetType;
  title: string;
  description: string;
  size: { w: number; h: number };
  /** Why it can't be added right now, or null if it can. */
  blocked: string | null;
}

export function paletteFor(kind: ViewKind, grid: Grid, placements: ViewPlacement[]): PaletteEntry[] {
  return widgetTypes
    .filter((type) => widgetAllowedOn(widgetRegistry[type], kind))
    .map((type) => {
      const def = widgetRegistry[type];
      const placed = placements.some((p) => p.type === type);
      return {
        type,
        title: def.title,
        description: def.description,
        size: def.size,
        blocked:
          widgetIsUnique(def) && placed
            ? 'Already on this view'
            : findFirstFit(grid, placements, def.size)
              ? null
              : 'No room left',
      };
    });
}

export function WidgetPalette({
  entries,
  onAdd,
  dragHandlers,
}: {
  entries: PaletteEntry[];
  onAdd: (type: WidgetType) => void;
  dragHandlers: (type: string, size: { w: number; h: number }) => Record<string, unknown>;
}) {
  return (
    <aside className="palette">
      <h2 className="palette__title">Widgets</h2>
      <ul className="palette__list">
        {entries.map((entry) => (
          <li
            key={entry.type}
            className={`palette__item${entry.blocked ? ' palette__item--off' : ''}`}
            {...(entry.blocked ? {} : dragHandlers(entry.type, entry.size))}
          >
            <div className="palette__text">
              <strong>{entry.title}</strong>
              <small>{entry.blocked ?? entry.description}</small>
            </div>
            <span className="palette__size mono" aria-hidden>
              {entry.size.w}×{entry.size.h}
            </span>
            <button
              type="button"
              className="iconbtn"
              disabled={Boolean(entry.blocked)}
              aria-label={`Add ${entry.title}`}
              title={entry.blocked ?? `Add ${entry.title}`}
              onClick={() => onAdd(entry.type)}
            >
              <Plus size={15} />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

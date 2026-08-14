import { ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { widgetRegistry, widgetTypes } from '../widgets/registry';
import { widgetAllowedOn, widgetIsUnique, type WidgetType } from '../widgets/types';
import { IntegrationBrand, integrationInfo, type IntegrationId } from '../components/IntegrationBrand';
import { findFirstFit, type Grid, type ViewKind } from '../lib/gridLayout';
import type { ViewPlacement } from '../api';
import type { AnalysisSource } from '../api';
import { analysisIntegration, analysisWidgetTitle } from '../lib/analysisSource';

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
  integration: IntegrationId;
  /** Why it can't be added right now, or null if it can. */
  blocked: string | null;
}

export function paletteFor(kind: ViewKind, grid: Grid, placements: ViewPlacement[], analysisSource?: AnalysisSource | null): PaletteEntry[] {
  return widgetTypes
    .filter((type) => widgetAllowedOn(widgetRegistry[type], kind))
    .map((type) => {
      const def = widgetRegistry[type];
      const placed = placements.some((p) => p.type === type);
      const analysisTitle = analysisWidgetTitle(type, analysisSource);
      return {
        type,
        title: analysisTitle ?? def.title,
        description: def.description,
        size: def.size,
        integration: analysisTitle ? analysisIntegration(analysisSource) : def.integration ?? 'prodmesh',
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
  // Keep the existing immediately-available palette behavior on first open;
  // each integration can then be collapsed into its dropdown header.
  const [openGroups, setOpenGroups] = useState<Set<IntegrationId>>(
    () => new Set(entries.map((entry) => entry.integration)),
  );
  const groups = entries.reduce((all, entry) => {
    (all.get(entry.integration) ?? all.set(entry.integration, []).get(entry.integration)!).push(entry);
    return all;
  }, new Map<IntegrationId, PaletteEntry[]>());

  return (
    <aside className="palette">
      <h2 className="palette__title">Widgets</h2>
      {[...groups.entries()].map(([integration, group]) => {
        const open = openGroups.has(integration);
        const name = integrationInfo[integration].name;
        return (
        <section className={`palette__group${open ? ' palette__group--open' : ''}`} key={integration} aria-label={`${name} widgets`}>
          <button
            type="button"
            className="palette__group-title"
            aria-label={`${name} widgets`}
            aria-expanded={open}
            aria-controls={`palette-${integration}`}
            onClick={() => setOpenGroups((current) => {
              const next = new Set(current);
              if (next.has(integration)) next.delete(integration);
              else next.add(integration);
              return next;
            })}
          >
            <IntegrationBrand integration={integration} />
            <span>{name}</span>
            <span className="palette__group-count">{group.length}</span>
            <ChevronDown className="palette__group-chevron" size={16} aria-hidden />
          </button>
          <ul className="palette__list" id={`palette-${integration}`} hidden={!open}>
            {group.map((entry) => (
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
        </section>
        );
      })}
    </aside>
  );
}

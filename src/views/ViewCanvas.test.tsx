import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewCanvas } from './ViewCanvas';
import { GRID } from '../lib/gridLayout';
import type { View, ViewPlacement } from '../api';

const api = vi.hoisted(() => ({
  getRoomService: vi.fn().mockResolvedValue({ configured: true, live: true, plans: [] }),
  getRoomPlan: vi.fn().mockResolvedValue({ live: true, plan: null }),
  getReport: vi.fn().mockResolvedValue({ items: [], totals: { planned: 0, actual: 0, delta: 0 }, completedAt: null }),
}));

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  ...api,
}));

const place = (id: string, type: string, x: number, y: number, w = 2, h = 1): ViewPlacement =>
  ({ id, type, x, y, w, h, config: {} });

const view = (widgets: ViewPlacement[], kind: View['kind'] = 'dashboard'): View => ({
  id: 'v1', roomId: 'north-main', kind, name: 'FOH', slug: 'foh',
  columns: kind === 'display' ? 3 : 6, maxRows: kind === 'display' ? 3 : null,
  position: 0, createdAt: 0, updatedAt: 0, widgets,
});

describe('ViewCanvas', () => {
  it('positions each placement on the grid it was given', () => {
    const { container } = render(
      <ViewCanvas
        view={view([place('a', 'countdown', 0, 0), place('b', 'loudness', 2, 1)])}
        grid={GRID.dashboard}
        config={{}}
      />,
    );

    const grid = container.querySelector('.viewgrid') as HTMLElement;
    expect(grid.style.getPropertyValue('--view-columns')).toBe('6');

    const cells = container.querySelectorAll<HTMLElement>('.viewcell');
    // CSS grid lines are 1-based; a placement at (0,0) starts on line 1.
    expect(cells[0].style.gridColumn).toBe('1 / span 2');
    expect(cells[0].style.gridRow).toBe('1 / span 1');
    expect(cells[1].style.gridColumn).toBe('3 / span 2');
    expect(cells[1].style.gridRow).toBe('2 / span 1');
  });

  it('an unknown widget keeps its slot, and the rest still render', async () => {
    // A view written by a newer build. Dropping the row would reflow the grid,
    // rearranging a layout somebody arranged by hand — on a screen they are
    // probably looking at mid-service.
    const { container } = render(
      <ViewCanvas
        view={view([
          place('a', 'countdown', 0, 0),
          place('x', 'from-the-future', 2, 0),
          place('b', 'loudness', 4, 0),
        ])}
        grid={GRID.dashboard}
        config={{}}
      />,
    );

    expect(container.querySelectorAll('.viewcell')).toHaveLength(3);
    expect(await screen.findByText('from-the-future')).toBeInTheDocument();
    expect(screen.getByText('Not available in this version')).toBeInTheDocument();

    // Its neighbours did not move up into the gap.
    const unknown = container.querySelector('.viewcell--unknown') as HTMLElement;
    expect(unknown.style.gridColumn).toBe('3 / span 2');
    expect(container.querySelectorAll<HTMLElement>('.viewcell')[2].style.gridColumn).toBe('5 / span 2');
  });

  it('a display is a fixed canvas; a dashboard grows', () => {
    const fixed = render(<ViewCanvas view={view([], 'display')} grid={GRID.display} config={{}} />);
    const displayGrid = fixed.container.querySelector('.viewgrid') as HTMLElement;
    expect(displayGrid.className).toContain('viewgrid--fixed');
    expect(displayGrid.style.getPropertyValue('--view-rows')).toBe('3');
    fixed.unmount();

    // A dashboard shows its starting canvas when empty, and stretches to hold
    // the deepest placement.
    const grown = render(
      <ViewCanvas view={view([place('a', 'countdown', 0, 6, 2, 2)])} grid={GRID.dashboard} config={{}} />,
    );
    const dashGrid = grown.container.querySelector('.viewgrid') as HTMLElement;
    expect(dashGrid.className).not.toContain('viewgrid--fixed');
    expect(dashGrid.style.getPropertyValue('--view-rows')).toBe('8');
  });

  it('the view’s context overrides a placement’s own, and empty means follow the room', () => {
    const pinned: ViewPlacement = { ...place('a', 'countdown', 0, 0), config: { planId: 'stored', timeId: 'st' } };

    // Menubar set → it wins, so re-scoping a dashboard is one dropdown.
    render(<ViewCanvas view={view([pinned])} grid={GRID.dashboard} config={{ planId: 'chosen' }} />);
    expect(api.getRoomPlan).toHaveBeenCalledWith('north-main', 'chosen');

    api.getRoomPlan.mockClear();
    api.getRoomService.mockClear();

    // Menubar on "Follow the room" → the placement's own config stands.
    render(<ViewCanvas view={view([pinned])} grid={GRID.dashboard} config={{}} />);
    expect(api.getRoomPlan).toHaveBeenCalledWith('north-main', 'stored');
  });
});

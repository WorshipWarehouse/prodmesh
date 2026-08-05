import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DisplayView } from './DisplayView';
import { emitTopic } from '../test/fakeEventSource';
import { clearQueryCache } from '../lib/useQuery';
import type { View } from '../api';

const api = vi.hoisted(() => ({
  getView: vi.fn(),
  getRoomService: vi.fn(),
  getRoomPlan: vi.fn(),
  getReport: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  ...api,
}));

const view = (name: string): View => ({
  id: 'v1', roomId: 'north-main', kind: 'display', name, slug: 'wall',
  columns: 3, maxRows: 3, position: 0, createdAt: 0, updatedAt: 0,
  widgets: [{ id: 'w1', type: 'countdown', x: 0, y: 0, w: 2, h: 1, config: {} }],
});

function renderDisplay(key = 'wall') {
  return render(
    <MemoryRouter initialEntries={[`/display/north-main/${key}`]}>
      <Routes>
        <Route path="/display/:roomId/:key" element={<DisplayView />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  clearQueryCache();
  api.getView.mockReset().mockResolvedValue({ view: view('Multiview') });
  api.getRoomService.mockReset().mockResolvedValue({ configured: true, live: true, plans: [] });
  api.getRoomPlan.mockReset().mockResolvedValue({ live: true, plan: null });
  api.getReport.mockReset().mockResolvedValue({
    items: [], totals: { planned: 0, actual: 0, delta: 0 }, completedAt: null,
  });
});

describe('DisplayView', () => {
  it('renders the grid and nothing else — no chrome to click', async () => {
    const { container } = renderDisplay();
    await waitFor(() => expect(container.querySelector('.viewgrid')).toBeInTheDocument());

    // It lives outside AppShell, so none of this is even in the tree.
    expect(container.querySelector('.sidebar')).toBeNull();
    expect(container.querySelector('.viewbar')).toBeNull();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('is a fixed canvas that cannot scroll — it is a tile on a multiview', async () => {
    const { container } = renderDisplay();
    await waitFor(() => expect(container.querySelector('.viewgrid')).toBeInTheDocument());
    const grid = container.querySelector('.viewgrid') as HTMLElement;
    expect(grid.className).toContain('viewgrid--fixed');
    expect(grid.style.getPropertyValue('--view-rows')).toBe('3');
    expect(grid.style.getPropertyValue('--view-columns')).toBe('3');
  });

  it('resolves an id as readily as a slug, so renaming cannot blank a screen', async () => {
    renderDisplay('v1');
    await waitFor(() => expect(api.getView).toHaveBeenCalledWith('north-main', 'v1'));
  });

  it('picks up a layout edited in the booth without anyone touching the screen', async () => {
    const { container } = renderDisplay();
    await waitFor(() => expect(container.querySelector('.viewgrid')).toBeInTheDocument());
    expect(api.getView).toHaveBeenCalledTimes(1);

    // The booth saves; the server publishes the room's views. A screen with no
    // keyboard has no other way to hear about it.
    api.getView.mockResolvedValue({ view: { ...view('Multiview'), widgets: [] } });
    await emitTopic({ 'room:north-main:views': [{ id: 'v1', slug: 'wall' }] });

    await waitFor(() => expect(api.getView).toHaveBeenCalledTimes(2));
  });

  it('shows nothing rather than an error nobody is there to read', async () => {
    api.getView.mockRejectedValue(new Error('HTTP 404'));
    const { container } = renderDisplay('gone');

    await waitFor(() => expect(container.querySelector('.display--blank')).toBeInTheDocument());
    // No "Loading…", no stack trace. A message left on a wall for a week stops
    // being read; a black rectangle is a fault someone notices.
    expect(container.textContent).toBe('');
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ViewsIndex } from './ViewsIndex';
import { IdentityContext } from '../lib/identity';
import { clearQueryCache } from '../lib/useQuery';
import type { AuthStatus, ViewSummary } from '../api';

const api = vi.hoisted(() => ({
  getRoom: vi.fn(),
  getViews: vi.fn(),
  createView: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  ...api,
}));

const view = (kind: ViewSummary['kind'], slug: string, name: string): ViewSummary => ({
  id: `id-${slug}`, roomId: 'north-main', kind, name, slug,
  columns: kind === 'display' ? 3 : 6, maxRows: kind === 'display' ? 3 : null,
  position: 0, createdAt: 0, updatedAt: 0,
});

const identity = (permissions: string[]): AuthStatus => ({
  authenticated: true, admin: false, setupNeeded: false,
  user: { id: 'u1', username: 'dana', displayName: 'Dana', planningCenterPersonId: null },
  permissions, station: null,
});

const Where = () => <p>at {useLocation().pathname}</p>;

function renderPage(perms: string[] = ['views.edit']) {
  return render(
    <IdentityContext.Provider value={identity(perms)}>
      <MemoryRouter initialEntries={['/room/north-main/views']}>
        <Routes>
          <Route path="/room/:roomId/views" element={<ViewsIndex />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </IdentityContext.Provider>,
  );
}

beforeEach(() => {
  clearQueryCache();
  api.getRoom.mockReset().mockResolvedValue({
    id: 'north-main', name: 'Main Auditorium', site: 'north', hasCompanion: true, modes: [],
  });
  api.getViews.mockReset().mockResolvedValue({
    views: [view('dashboard', 'foh', 'Front of House'), view('display', 'wall', 'Multiview')],
  });
  api.createView.mockReset().mockResolvedValue({ view: view('dashboard', 'camera-shading', 'Camera Shading') });
});

describe('ViewsIndex', () => {
  it('lists both kinds under their own headings', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: /^Front of House/ })).toHaveAttribute(
      'href', '/room/north-main/view/foh',
    );
    expect(screen.getByRole('heading', { name: 'Dashboards' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Displays' })).toBeInTheDocument();
    expect(screen.getByText('6×∞')).toBeInTheDocument();
    expect(screen.getByText('3×3')).toBeInTheDocument();
  });

  it('creating one derives the URL from the name and opens the editor', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /New dashboard/ }));

    // The field is LABELLED — it had no accessible name at all when the dialog
    // was first written, which is invisible until someone uses a screen reader.
    const name = screen.getByLabelText('Name');
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();

    await user.type(name, 'Camera Shading');
    // The slug is shown, not hidden: it is the address a screen gets pointed
    // at, and someone will have to type it into a kiosk one day.
    expect(screen.getByText('/camera-shading')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(api.createView).toHaveBeenCalledWith('north-main', {
      kind: 'dashboard', name: 'Camera Shading', slug: 'camera-shading',
    });
    // Straight into the editor — an empty view is not somewhere to leave
    // someone standing.
    expect(await screen.findByText('at /room/north-main/view/camera-shading/edit')).toBeInTheDocument();
  });

  it('a name with no usable slug cannot be submitted', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /New display/ }));
    await user.type(screen.getByLabelText('Name'), '!!!');
    expect(screen.queryByText(/^\//)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('surfaces a refusal from the server instead of closing on nothing', async () => {
    api.createView.mockRejectedValue(new Error('This room already has a view called "foh"'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /New dashboard/ }));
    await user.type(screen.getByLabelText('Name'), 'FOH');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('This room already has a view called "foh"')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('FOH');
  });

  it('offers no editing to an account without the permission', async () => {
    renderPage(['reports.view']);
    expect(await screen.findByRole('link', { name: /^Front of House/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New dashboard/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Edit/ })).not.toBeInTheDocument();
  });
});

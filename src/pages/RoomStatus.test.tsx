import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RoomStatus } from './RoomStatus';
import type { RoomMeta, RoomState } from '../api';

const api = vi.hoisted(() => ({
  getRoom: vi.fn(),
  getRoomState: vi.fn(),
  setRoomMode: vi.fn(),
}));

// Partial mock: OverrideRequiredError must be the REAL class so the page's
// `instanceof` check in confirmMode sees the same constructor the mock throws.
vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  ...api,
}));

// ServicePanel fetches Planning Center data on its own — out of scope here.
vi.mock('../components/ServicePanel', () => ({
  ServicePanel: () => <div data-testid="service-panel" />,
}));

import { OverrideRequiredError } from '../api';

const room: RoomMeta = {
  id: 'north-main',
  name: 'Main Auditorium',
  site: 'north',
  hasCompanion: true,
  modes: [
    { id: 'show', label: 'Show', color: '#e33', isStandby: false },
    { id: 'walkin', label: 'Walk In', color: '#3a6', isStandby: false },
    { id: 'off', label: 'Standby', color: '#667', isStandby: true },
  ],
};

const baseState: RoomState = {
  mode: 'walkin',
  raw: 'walkin',
  online: true,
  source: 'companion',
  protection: { active: false, label: null, lockedModes: [], enforced: false },
};

const lockedState: RoomState = {
  ...baseState,
  protection: {
    active: true,
    label: 'Sunday services',
    lockedModes: ['off'],
    enforced: true,
  },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/room/north-main']}>
      <Routes>
        <Route path="/room/:roomId" element={<RoomStatus />} />
      </Routes>
    </MemoryRouter>,
  );
}

const dialog = () => screen.getByRole('dialog');

beforeEach(() => {
  api.getRoom.mockResolvedValue(room);
  api.getRoomState.mockResolvedValue(baseState);
  api.setRoomMode.mockReset();
});

describe('mode buttons', () => {
  it('renders every mode, marks the current one active and disabled', async () => {
    renderPage();

    expect(await screen.findByText('Companion live')).toBeInTheDocument();
    const active = screen.getByRole('button', { name: /Walk In/ });
    expect(active).toBeDisabled();
    expect(within(active).getByText('Active now')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Standby' })).toBeEnabled();
  });

  it('confirms an unlocked change and applies the server response', async () => {
    const next = { ...baseState, mode: 'show', raw: 'show' };
    // confirmMode refreshes state afterwards — from then on the server
    // reports the new mode (before the change it still reports walkin).
    api.setRoomMode.mockImplementation(async () => {
      api.getRoomState.mockResolvedValue(next);
      return next;
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Show' }));
    expect(within(dialog()).getByText(/Switch/)).toBeInTheDocument();
    await user.click(within(dialog()).getByRole('button', { name: 'Yes, Show' }));

    // No PIN prompt for an unlocked mode — overridePin stays undefined.
    expect(api.setRoomMode).toHaveBeenCalledWith('north-main', 'show', undefined);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const active = screen.getByRole('button', { name: /^Show/ });
    expect(active).toBeDisabled();
    expect(within(active).getByText('Active now')).toBeInTheDocument();
  });

  it('Cancel closes the dialog without calling the API', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Show' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.setRoomMode).not.toHaveBeenCalled();
  });
});

describe('override-PIN flow', () => {
  beforeEach(() => {
    api.getRoomState.mockResolvedValue(lockedState);
  });

  it('shows the protection banner and a lock on the locked mode', async () => {
    renderPage();

    expect(await screen.findByText('Sunday services')).toBeInTheDocument();
    expect(screen.getByText(/override PIN required/)).toBeInTheDocument();
    const locked = screen.getByRole('button', { name: /Standby/ });
    expect(within(locked).getByLabelText('locked')).toBeInTheDocument();
  });

  it('requires a PIN, rejects a wrong one, and completes with the right one', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Sunday services');

    await user.click(screen.getByRole('button', { name: /Standby/ }));
    const pinInput = within(dialog()).getByLabelText(/Enter override PIN/);

    // Empty PIN never reaches the server.
    await user.click(within(dialog()).getByRole('button', { name: 'Yes, Standby' }));
    expect(await screen.findByText('Enter the override PIN to continue.')).toBeInTheDocument();
    expect(api.setRoomMode).not.toHaveBeenCalled();

    // Wrong PIN → server 403 override_required → specific message, dialog stays.
    api.setRoomMode.mockRejectedValueOnce(new OverrideRequiredError());
    await user.type(pinInput, '0000');
    await user.click(within(dialog()).getByRole('button', { name: 'Yes, Standby' }));
    expect(await screen.findByText('Incorrect override PIN.')).toBeInTheDocument();
    expect(api.setRoomMode).toHaveBeenCalledWith('north-main', 'off', '0000');

    // Correct PIN → mode applies, dialog closes.
    api.setRoomMode.mockResolvedValueOnce({ ...lockedState, mode: 'off', raw: 'off' });
    await user.clear(pinInput);
    await user.type(pinInput, '4457');
    await user.click(within(dialog()).getByRole('button', { name: 'Yes, Standby' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.setRoomMode).toHaveBeenLastCalledWith('north-main', 'off', '4457');
  });

  it('reports a generic failure distinctly from a wrong PIN', async () => {
    api.setRoomMode.mockRejectedValue(new Error('HTTP 502'));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Sunday services');

    await user.click(screen.getByRole('button', { name: /Standby/ }));
    await user.type(within(dialog()).getByLabelText(/Enter override PIN/), '4457');
    await user.click(within(dialog()).getByRole('button', { name: 'Yes, Standby' }));

    expect(await screen.findByText('Something went wrong — try again.')).toBeInTheDocument();
    expect(screen.queryByText('Incorrect override PIN.')).not.toBeInTheDocument();
  });
});

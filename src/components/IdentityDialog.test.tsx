import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentityDialog } from './IdentityDialog';
import { ChurchContext } from '../layout/church';
import type { AuthStatus, Station } from '../api';

const api = vi.hoisted(() => ({
  registerStation: vi.fn(),
  loginUser: vi.fn(),
}));

vi.mock('../api', () => api);

const testChurch = {
  name: 'Test Church',
  sites: [
    { id: 'north', name: 'North Campus', status: 'active' as const, auditoriums: [] },
    { id: 'south', name: 'South Campus', status: 'disabled' as const, auditoriums: [] },
  ],
};

const station: Station = {
  id: 'station-1',
  name: 'FOH – Producer',
  campusId: 'north',
  roomId: null,
  roomOnly: false,
};

const readOnlyStatus: AuthStatus = {
  authenticated: false,
  admin: false,
  setupNeeded: false,
  user: null,
  permissions: [],
  station,
};

describe('IdentityDialog', () => {
  beforeEach(() => {
    api.registerStation.mockReset();
    api.loginUser.mockReset();
  });

  it('registers a named station with an active campus', async () => {
    api.registerStation.mockResolvedValue(station);
    const onStation = vi.fn();
    const user = userEvent.setup();

    render(
      <ChurchContext.Provider value={testChurch}>
      <IdentityDialog
        stationRequired
        campusId="*"
        status={null}
        onStation={onStation}
        onLogin={vi.fn()}
        onClose={vi.fn()}
      />
      </ChurchContext.Provider>,
    );

    const submit = screen.getByRole('button', { name: 'Register station' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Station name' }), 'FOH – Producer');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Campus' }), 'north');
    await user.click(submit);

    await waitFor(() => expect(api.registerStation).toHaveBeenCalledWith({
      name: 'FOH – Producer',
      campusId: 'north',
    }));
    expect(onStation).toHaveBeenCalledWith(station);
    expect(screen.queryByRole('option', { name: /South Campus/i })).not.toBeInTheDocument();
  });

  it('points an administrator at the credential they already know', () => {
    // The reconciliation in ADR 0012: the admin PIN is the `admin` account's
    // PIN, so it works in this box. Discoverability was the actual complaint —
    // people reached for it here and it failed.
    render(
      <IdentityDialog
        stationRequired={false}
        campusId="north"
        status={readOnlyStatus}
        onStation={vi.fn()}
        onLogin={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /log in as .?admin.? with the admin PIN/i })).toBeInTheDocument();
  });

  it('logs in on Enter and reports authentication failures', async () => {
    api.loginUser.mockRejectedValue(new Error('Invalid username or PIN'));
    const user = userEvent.setup();

    render(
      <ChurchContext.Provider value={testChurch}>
      <IdentityDialog
        stationRequired={false}
        campusId="north"
        status={readOnlyStatus}
        onStation={vi.fn()}
        onLogin={vi.fn()}
        onClose={vi.fn()}
      />
      </ChurchContext.Provider>,
    );

    await user.type(screen.getByRole('textbox', { name: 'Username' }), 'operator');
    await user.type(screen.getByLabelText('PIN'), '0000{Enter}');

    expect(await screen.findByText('Invalid username or PIN')).toBeInTheDocument();
    expect(api.loginUser).toHaveBeenCalledWith('operator', '0000');
  });

  // Opened by a 403, the old copy said only "Log in" — to someone who already
  // had. Reads as a broken session; the actual problem is the account.
  it('names the missing permission when the operator is already logged in', () => {
    render(
      <ChurchContext.Provider value={testChurch}>
      <IdentityDialog
        stationRequired={false}
        campusId="north"
        status={{
          ...readOnlyStatus,
          authenticated: true,
          user: { id: 'u1', username: 'sam', displayName: 'Sam Rivera', planningCenterPersonId: null },
          permissions: ['reports.view'],
        }}
        denied={{ permission: 'shows.operate', label: 'Operate shows' }}
        onStation={vi.fn()}
        onLogin={vi.fn()}
        onClose={vi.fn()}
      />
      </ChurchContext.Provider>,
    );

    expect(screen.getByRole('heading', { name: 'Log in as someone else' })).toBeInTheDocument();
    expect(screen.getByText(/does not have “Operate shows”/)).toBeInTheDocument();
    expect(screen.getByText('Sam Rivera')).toBeInTheDocument();
  });

  it('a read-only station is told what logging in is for', () => {
    render(
      <ChurchContext.Provider value={testChurch}>
      <IdentityDialog
        stationRequired={false}
        campusId="north"
        status={readOnlyStatus}
        denied={{ permission: 'shows.operate', label: 'Operate shows' }}
        onStation={vi.fn()}
        onLogin={vi.fn()}
        onClose={vi.fn()}
      />
      </ChurchContext.Provider>,
    );

    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByText('Logging in is needed for “Operate shows”.')).toBeInTheDocument();
  });
});

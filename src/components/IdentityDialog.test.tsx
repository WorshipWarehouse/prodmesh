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
    { id: 'north', name: 'North', status: 'active' as const, auditoriums: [] },
    { id: 'south-everett', name: 'South Campus', status: 'disabled' as const, auditoriums: [] },
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
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CampusesPanel, LogsPanel, RoomConfigPanel, StationsPanel, SystemPanel, UserManagementPanel } from './Settings';

const api = vi.hoisted(() => ({
  getVersion: vi.fn(),
  triggerUpdate: vi.fn(),
  getUserDirectory: vi.fn(),
  createUser: vi.fn(),
  createGroup: vi.fn(),
  setUserGroups: vi.fn(),
  getStations: vi.fn(),
  getRooms: vi.fn(),
  getViews: vi.fn(),
  updateStation: vi.fn(),
  revokeStation: vi.fn(),
  getServerLog: vi.fn(),
  getAuditLog: vi.fn(),
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  getRoomConnectivity: vi.fn(),
  savePcServiceTypes: vi.fn(),
  saveAnalysis: vi.fn(),
  saveProPresenter: vi.fn(),
  saveCompanion: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  ...api,
}));

describe('Users & access', () => {
  beforeEach(() => {
    api.getUserDirectory.mockResolvedValue({
      users: [
        {
          id: 'with-photo', username: 'photo', displayName: 'Photo User',
          planningCenterPersonId: '123', avatarUrl: 'https://example.test/photo.jpg',
          active: true, groups: [], permissions: [],
        },
        {
          id: 'without-photo', username: 'placeholder', displayName: 'Placeholder User',
          planningCenterPersonId: null, avatarUrl: null,
          active: true, groups: [], permissions: [],
        },
      ],
      groups: [],
      permissions: [],
    });
  });

  it('shows a Planning Center photo or the standard placeholder for every user', async () => {
    render(<UserManagementPanel />);

    const photo = await screen.findByRole('img', { name: 'Photo User avatar' });
    const placeholder = screen.getByRole('img', { name: 'Placeholder User avatar' });
    expect(photo.querySelector('img')).toHaveAttribute('src', 'https://example.test/photo.jpg');
    expect(placeholder.querySelector('svg')).toBeInTheDocument();
  });
});

describe('Stations', () => {
  beforeEach(() => {
    api.getStations.mockResolvedValue({
      stations: [{
        id: 'station-1', name: 'Old Booth', campusId: 'north', roomId: null,
        createdAt: Date.now() - 10000, lastSeen: Date.now(), current: true,
      }],
    });
    api.getRooms.mockResolvedValue([{
      id: 'north-main', name: 'Main Auditorium', site: 'north', hasCompanion: true, modes: [],
    }]);
    api.updateStation.mockImplementation(async (_id, input) => ({
      id: 'station-1', ...input, createdAt: Date.now() - 10000, lastSeen: Date.now(), current: true,
    }));
    api.revokeStation.mockResolvedValue({ current: false });
    api.getViews.mockResolvedValue({ views: [] });
  });

  it('renames and assigns a station, then confirms before revoking it', async () => {
    const user = userEvent.setup();
    render(<StationsPanel />);

    expect(await screen.findByText(/CURRENT STATION/)).toBeInTheDocument();
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'FOH – Producer');
    await user.selectOptions(screen.getByLabelText('Room'), 'north-main');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.updateStation).toHaveBeenCalledWith('station-1', {
      name: 'FOH – Producer', campusId: 'north', roomId: 'north-main', roomOnly: false,
      // An ordinary browser, not a display. Sent explicitly rather than
      // omitted so assigning one and clearing it are the same shape.
      viewId: null,
    });

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(api.revokeStation).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /Unregister FOH – Producer/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke station' }));
    expect(api.revokeStation).toHaveBeenCalledWith('station-1');
  });
});

describe('Logs', () => {
  beforeEach(() => {
    api.getServerLog.mockResolvedValue({
      exists: true,
      file: '/srv/prodmesh/logs/server.log',
      size: 2048,
      mtime: Date.now(),
      truncated: false,
      lines: [
        'Production dashboard server on http://localhost:8080',
        '[smaart] 192.0.2.40: Smaart v8 8.5.2.2 via /api/v3/',
        '[autostart] north-main: armed for 900102',
      ],
    });
    api.getAuditLog.mockResolvedValue({
      entries: [{
        id: 1, ts: Date.now(), action: 'rooms.mode.change', result: 'allowed',
        resourceType: 'room-mode', resourceId: 'sunday', roomId: 'north-main', planId: null,
        userName: 'Sam', username: 'sam', stationName: 'FOH – Producer', details: null,
      }],
    });
  });

  it('shows the server log tail, filters it, and switches to the audit trail', async () => {
    const user = userEvent.setup();
    render(<LogsPanel />);

    const log = await screen.findByTestId('server-log');
    expect(log).toHaveTextContent('Smaart v8 8.5.2.2');
    expect(log).toHaveTextContent('Production dashboard server');

    await user.type(screen.getByPlaceholderText(/Filter lines/), 'smaart');
    expect(log).toHaveTextContent('Smaart v8 8.5.2.2');
    expect(log).not.toHaveTextContent('Production dashboard server');

    await user.click(screen.getByRole('button', { name: 'Audit trail' }));
    expect(await screen.findByText('rooms.mode.change')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByText('allowed')).toBeInTheDocument();
  });
});

describe('System', () => {
  const version = {
    version: '1.0.0', commit: 'c5b551d', subject: 'Ship it', source: 'git' as const,
    deployment: 'git' as const,
    update: { supported: true, strategy: 'git' as const, reason: null },
  };

  beforeEach(() => vi.clearAllMocks());

  it('offers an update on an install that can perform one', async () => {
    api.getVersion.mockResolvedValue(version);
    render(<SystemPanel />);

    expect(await screen.findByText('c5b551d')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update now' })).toBeInTheDocument();
  });

  it('hides the update button where it cannot work, and says what to do instead', async () => {
    // A button that does nothing is worse than no button: someone presses it
    // mid-service and reads the silence as a broken install.
    api.getVersion.mockResolvedValue({
      ...version,
      source: 'build' as const,
      deployment: 'container' as const,
      update: {
        supported: false,
        strategy: 'container' as const,
        reason: 'Update by pulling a newer image and recreating the container.',
      },
    });
    render(<SystemPanel />);

    expect(await screen.findByText(/pulling a newer image/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update now' })).not.toBeInTheDocument();
  });

  it('still names a version when there is no commit to show', async () => {
    // A release archive: it knows what version it is, just not from which commit.
    api.getVersion.mockResolvedValue({
      ...version,
      commit: 'unknown', subject: '', source: 'package' as const, deployment: 'package' as const,
      update: { supported: false, strategy: 'manual' as const, reason: 'Install the new version the same way.' },
    });
    render(<SystemPanel />);

    expect(await screen.findByText(/1\.0\.0/)).toBeInTheDocument();
    expect(screen.queryByText('unknown')).not.toBeInTheDocument();
  });
});

describe('Campuses', () => {
  const church = {
    name: 'Test Church',
    sites: [{
      id: 'north', name: 'North Campus', status: 'active' as const,
      auditoriums: [{
        id: 'north-main', name: 'Main Auditorium',
        tiles: [
          { id: 'main-companion', type: 'companion' as const, label: 'Companion', host: '192.0.2.10' },
          { id: 'main-cam', type: 'link' as const, label: 'Camera 9', url: 'http://192.0.2.20' },
        ],
      }],
    }],
  };

  beforeEach(() => {
    api.getConfig.mockReset();
    api.saveConfig.mockReset();
    api.savePcServiceTypes.mockReset();
    api.getConfig.mockResolvedValue(structuredClone(church));
    api.saveConfig.mockImplementation(async (c: unknown) => c);
    api.getRoomConnectivity.mockResolvedValue({
      hasServerRoom: true,
      planningCenter: { serviceTypes: [{ id: '500001', name: 'Sunday' }] },
      analysis: { source: 'smaart', host: '192.0.2.40', port: 26000, target: 90, limit: 95, hasPassword: false },
      proPresenter: { host: '192.0.2.15', port: 62202 },
      companion: {
        mock: false, host: '192.0.2.51', port: 8000, variable: 'roomState',
        modes: [
          { id: 'sunday', label: 'Sunday', color: '#34c759', match: 'SUNDAY', press: { page: 1, row: 3, column: 1 } },
          { id: 'standby', label: 'Standby', color: '#8b97a8', match: 'STANDBY', press: { page: 1, row: 3, column: 4 }, isStandby: true },
        ],
      },
    });
    api.savePcServiceTypes.mockImplementation(async (_room: string, serviceTypes: unknown) => ({ serviceTypes }));
    api.saveAnalysis.mockReset();
    api.saveAnalysis.mockImplementation(async (_room: string, analysis: unknown) => analysis);
    api.saveProPresenter.mockReset();
    api.saveProPresenter.mockImplementation(async (_room: string, proPresenter: unknown) => proPresenter);
    api.saveCompanion.mockReset();
    api.saveCompanion.mockImplementation(async (_room: string, companion: unknown) => companion);
  });

  it('overview lists rooms with Configure links; new rooms need a save first', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><CampusesPanel /></MemoryRouter>);

    expect(await screen.findByText('Main Auditorium')).toBeInTheDocument();
    expect(screen.getByText('2 tiles')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Configure' })).toHaveAttribute('href', '/admin/campuses/north-main');

    await user.click(screen.getByRole('button', { name: '+ Add room' }));
    expect(screen.getByText('save to configure')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalled());
    const sent = api.saveConfig.mock.calls[0][0];
    expect(sent.sites[0].auditoriums).toHaveLength(2);
  });

  it('room page edits a tile host and saves the whole tree', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/admin/campuses/north-main']}>
        <Routes>
          <Route path="/admin/campuses/:roomId" element={<RoomConfigPanel />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Quick Access tiles')).toBeInTheDocument();
    // Two Host fields exist (Companion tile + analysis source) — take the tile's.
    const host = screen.getAllByLabelText('Host').find((el) => (el as HTMLInputElement).value === '192.0.2.10')!;
    await user.clear(host);
    await user.type(host, '192.0.2.17');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.saveConfig).toHaveBeenCalled());
    const sent = api.saveConfig.mock.calls[0][0];
    expect(sent.sites[0].auditoriums[0].tiles[0].host).toBe('192.0.2.17');
  });

  it('edits Planning Center service types independently of the topology save', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/admin/campuses/north-main']}>
        <Routes>
          <Route path="/admin/campuses/:roomId" element={<RoomConfigPanel />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Planning Center service types')).toBeInTheDocument();
    // "Sunday" is also a mode label now — pick the service-type name field.
    const pcName = screen.getAllByDisplayValue('Sunday')
      .find((el) => (el as HTMLInputElement).placeholder === 'e.g. Sunday');
    expect(pcName).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '+ Add service type' }));
    const names = screen.getAllByLabelText('Name');
    const ids = screen.getAllByLabelText('Service type ID');
    await user.type(names[names.length - 1], 'Second Service');
    await user.type(ids[ids.length - 1], '500002');
    await user.click(screen.getByRole('button', { name: 'Save service types' }));

    await waitFor(() => expect(api.savePcServiceTypes).toHaveBeenCalledWith('north-main', [
      { id: '500001', name: 'Sunday' },
      { id: '500002', name: 'Second Service' },
    ]));
    expect(api.saveConfig).not.toHaveBeenCalled();
  });

  it('switches the analysis source to ProdMesh RTA and saves it', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/admin/campuses/north-main']}>
        <Routes>
          <Route path="/admin/campuses/:roomId" element={<RoomConfigPanel />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Analysis source')).toBeInTheDocument();
    expect(screen.getByDisplayValue('192.0.2.40')).toBeInTheDocument();
    // Smaart shows the password field; RTA must not.
    expect(screen.getByLabelText('API password')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Source'), 'rta');
    expect(screen.queryByLabelText('API password')).not.toBeInTheDocument();
    expect(screen.queryByText(/Start\/stop SPL logging/)).not.toBeInTheDocument();
    const host = screen.getAllByLabelText('Host').find((el) => (el as HTMLInputElement).value === '192.0.2.40')!;
    await user.clear(host);
    await user.type(host, '192.0.2.52');
    await user.click(screen.getByRole('button', { name: 'Save analysis source' }));

    await waitFor(() => expect(api.saveAnalysis).toHaveBeenCalledWith('north-main', {
      source: 'rta', host: '192.0.2.52', port: 26000, target: 90, limit: 95, metric: undefined,
    }));
    expect(api.saveConfig).not.toHaveBeenCalled();
  });

  it('enables show-driven SPL log control for a Smaart source', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/admin/campuses/north-main']}>
        <Routes>
          <Route path="/admin/campuses/:roomId" element={<RoomConfigPanel />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Analysis source')).toBeInTheDocument();
    await user.click(screen.getByText(/Start\/stop SPL logging/));
    await user.click(screen.getByRole('button', { name: 'Save analysis source' }));

    await waitFor(() => expect(api.saveAnalysis).toHaveBeenCalledWith('north-main', {
      source: 'smaart', host: '192.0.2.40', port: 26000, target: 90, limit: 95,
      metric: undefined, logControl: true,
    }));
  });

  it('edits ProPresenter connectivity and clears it by blanking the host', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/admin/campuses/north-main']}>
        <Routes>
          <Route path="/admin/campuses/:roomId" element={<RoomConfigPanel />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('ProPresenter')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Countdown timer'), 'Service Start');
    await user.click(screen.getByRole('button', { name: 'Save ProPresenter' }));
    await waitFor(() => expect(api.saveProPresenter).toHaveBeenCalledWith('north-main', {
      host: '192.0.2.15', port: 62202, timer: 'Service Start',
    }));

    // Blanking the host means "no ProPresenter in this room" — saves a clear.
    const host = screen.getAllByLabelText('Host').find((el) => (el as HTMLInputElement).value === '192.0.2.15')!;
    await user.clear(host);
    await user.click(screen.getByRole('button', { name: 'Save ProPresenter' }));
    await waitFor(() => expect(api.saveProPresenter).toHaveBeenLastCalledWith('north-main', null));
  });

  it('moves a mode button to a different page/row/col and adds a new mode', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/admin/campuses/north-main']}>
        <Routes>
          <Route path="/admin/campuses/:roomId" element={<RoomConfigPanel />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Companion & modes')).toBeInTheDocument();
    // Re-point the Sunday mode's button (first mode row) to page 3, row 0.
    const [page] = screen.getAllByLabelText('Page');
    const [row] = screen.getAllByLabelText('Row');
    await user.clear(page);
    await user.type(page, '3');
    await user.clear(row);
    await user.type(row, '0');

    await user.click(screen.getByRole('button', { name: '+ Add mode' }));
    const labels = screen.getAllByLabelText('Label');
    const ids = screen.getAllByLabelText('ID');
    const matches = screen.getAllByLabelText('Match');
    await user.type(labels[labels.length - 1], 'Second Service');
    await user.type(ids[ids.length - 1], 'second');
    await user.type(matches[matches.length - 1], 'SECOND');

    await user.click(screen.getByRole('button', { name: 'Save Companion' }));
    await waitFor(() => expect(api.saveCompanion).toHaveBeenCalledWith('north-main', {
      mock: false, host: '192.0.2.51', port: 8000, variable: 'roomState',
      modes: [
        { id: 'sunday', label: 'Sunday', color: '#34c759', match: 'SUNDAY', press: { page: 3, row: 0, column: 1 } },
        { id: 'standby', label: 'Standby', color: '#8b97a8', match: 'STANDBY', press: { page: 1, row: 3, column: 4 }, isStandby: true },
        { id: 'second', label: 'Second Service', color: '#5b8def', match: 'SECOND' },
      ],
    }));
  });

  it('room page shows not-found for an unknown room id', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/campuses/nope']}>
        <Routes>
          <Route path="/admin/campuses/:roomId" element={<RoomConfigPanel />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/No room "nope" exists/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← All campuses' })).toBeInTheDocument();
  });
});

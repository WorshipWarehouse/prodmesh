import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CampusesPanel, LogsPanel, RoomConfigPanel, StationsPanel, UserManagementPanel } from './Settings';

const api = vi.hoisted(() => ({
  getUserDirectory: vi.fn(),
  createUser: vi.fn(),
  createGroup: vi.fn(),
  setUserGroups: vi.fn(),
  getStations: vi.fn(),
  getRooms: vi.fn(),
  updateStation: vi.fn(),
  revokeStation: vi.fn(),
  getServerLog: vi.fn(),
  getAuditLog: vi.fn(),
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  getRoomConnectivity: vi.fn(),
  savePcServiceTypes: vi.fn(),
  saveAnalysis: vi.fn(),
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
      name: 'FOH – Producer', campusId: 'north', roomId: 'north-main',
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
        '[smaart] 192.0.2.7: Smaart v8 8.5.2.2 via /api/v3/',
        '[autostart] north-main: armed for 900102',
      ],
    });
    api.getAuditLog.mockResolvedValue({
      entries: [{
        id: 1, ts: Date.now(), action: 'rooms.mode.change', result: 'allowed',
        resourceType: 'room-mode', resourceId: 'sunday', roomId: 'north-main', planId: null,
        userName: 'the maintainer', username: 'justin', stationName: 'FOH – Producer', details: null,
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
    expect(screen.getByText('the maintainer')).toBeInTheDocument();
    expect(screen.getByText('allowed')).toBeInTheDocument();
  });
});

describe('Campuses', () => {
  const church = {
    name: 'Test Church',
    sites: [{
      id: 'north', name: 'North', status: 'active' as const,
      auditoriums: [{
        id: 'north-main', name: 'Main Auditorium',
        tiles: [
          { id: 'main-companion', type: 'companion' as const, label: 'Companion', host: '192.0.2.31' },
          { id: 'main-cam', type: 'link' as const, label: 'Camera 9', url: 'http://192.0.2.129' },
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
      analysis: { source: 'smaart', host: '192.0.2.7', port: 26000, target: 90, limit: 95, hasPassword: false },
    });
    api.savePcServiceTypes.mockImplementation(async (_room: string, serviceTypes: unknown) => ({ serviceTypes }));
    api.saveAnalysis.mockReset();
    api.saveAnalysis.mockImplementation(async (_room: string, analysis: unknown) => analysis);
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
    const host = screen.getAllByLabelText('Host').find((el) => (el as HTMLInputElement).value === '192.0.2.31')!;
    await user.clear(host);
    await user.type(host, '192.0.2.99');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.saveConfig).toHaveBeenCalled());
    const sent = api.saveConfig.mock.calls[0][0];
    expect(sent.sites[0].auditoriums[0].tiles[0].host).toBe('192.0.2.99');
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
    expect(screen.getByDisplayValue('Sunday')).toBeInTheDocument();

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
    expect(screen.getByDisplayValue('192.0.2.7')).toBeInTheDocument();
    // Smaart shows the password field; RTA must not.
    expect(screen.getByLabelText('API password')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Source'), 'rta');
    expect(screen.queryByLabelText('API password')).not.toBeInTheDocument();
    const host = screen.getAllByLabelText('Host').find((el) => (el as HTMLInputElement).value === '192.0.2.7')!;
    await user.clear(host);
    await user.type(host, '192.0.2.50');
    await user.click(screen.getByRole('button', { name: 'Save analysis source' }));

    await waitFor(() => expect(api.saveAnalysis).toHaveBeenCalledWith('north-main', {
      source: 'rta', host: '192.0.2.50', port: 26000, target: 90, limit: 95, metric: undefined,
    }));
    expect(api.saveConfig).not.toHaveBeenCalled();
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

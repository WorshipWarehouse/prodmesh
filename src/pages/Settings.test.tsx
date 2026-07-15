import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CampusesPanel, LogsPanel, StationsPanel, UserManagementPanel } from './Settings';

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
    api.getConfig.mockResolvedValue(structuredClone(church));
    api.saveConfig.mockImplementation(async (c: unknown) => c);
  });

  it('edits a tile host and saves the whole tree', async () => {
    const user = userEvent.setup();
    render(<CampusesPanel />);

    expect(await screen.findByText('Campuses & tiles')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Saved' });
    expect(save).toBeDisabled();

    const host = screen.getByLabelText('Host');
    await user.clear(host);
    await user.type(host, '192.0.2.99');

    const enabled = screen.getByRole('button', { name: 'Save changes' });
    await user.click(enabled);

    await waitFor(() => expect(api.saveConfig).toHaveBeenCalled());
    const sent = api.saveConfig.mock.calls[0][0];
    expect(sent.sites[0].auditoriums[0].tiles[0].host).toBe('192.0.2.99');
    expect(await screen.findByText(/Saved\. All screens/)).toBeInTheDocument();
  });

  it('adds a room and a tile to the draft', async () => {
    const user = userEvent.setup();
    render(<CampusesPanel />);
    await screen.findByText('Campuses & tiles');

    await user.click(screen.getByRole('button', { name: '+ Add room' }));
    expect(screen.getAllByLabelText('Room name')).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: '+ Add tile' })[1]);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalled());
    const sent = api.saveConfig.mock.calls[0][0];
    expect(sent.sites[0].auditoriums).toHaveLength(2);
    expect(sent.sites[0].auditoriums[1].tiles).toHaveLength(1);
  });
});

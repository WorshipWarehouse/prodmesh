import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserManagementPanel } from './Settings';

const api = vi.hoisted(() => ({
  getUserDirectory: vi.fn(),
  createUser: vi.fn(),
  createGroup: vi.fn(),
  setUserGroups: vi.fn(),
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

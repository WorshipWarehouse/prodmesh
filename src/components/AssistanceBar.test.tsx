import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistanceBar } from './AssistanceBar';
import { clearQueryCache } from '../lib/useQuery';

const api = vi.hoisted(() => ({
  getAssistance: vi.fn(),
  dismissAssistance: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  ...api,
}));

beforeEach(() => {
  clearQueryCache();
  api.getAssistance.mockReset();
  api.dismissAssistance.mockReset();
});

describe('AssistanceBar', () => {
  it('renders nothing when there is no open request, and never fetches when disabled', async () => {
    api.getAssistance.mockResolvedValue({ active: false });
    const { container, rerender } = render(<AssistanceBar enabled={false} />);
    expect(api.getAssistance).not.toHaveBeenCalled(); // unregistered station: no polling
    expect(container).toBeEmptyDOMElement();

    rerender(<AssistanceBar enabled />);
    await waitFor(() => expect(api.getAssistance).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the reminder while a request is open; Dismiss clears it', async () => {
    api.getAssistance.mockResolvedValue({
      active: true,
      requestedAt: new Date('2026-07-26T17:42:00Z').getTime(),
      userName: 'the maintainer',
    });
    api.dismissAssistance.mockImplementation(async () => {
      api.getAssistance.mockResolvedValue({ active: false });
    });
    const user = userEvent.setup();
    render(<AssistanceBar enabled />);

    expect(await screen.findByText('Assistance requested')).toBeInTheDocument();
    expect(screen.getByText(/help is on the way/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Dismiss/ }));

    expect(api.dismissAssistance).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Assistance requested')).not.toBeInTheDocument());
  });

  it('shows who acknowledged (👀) — or a generic label when the name is unknown', async () => {
    api.getAssistance.mockResolvedValue({
      active: true,
      requestedAt: Date.now(),
      userName: null,
      ack: { name: 'Pastor Tech', at: new Date('2026-07-26T17:44:00Z').getTime() },
    });
    const { unmount } = render(<AssistanceBar enabled />);
    expect(await screen.findByText('Pastor Tech')).toBeInTheDocument();
    expect(screen.getByText(/has seen this and is on the way/)).toBeInTheDocument();
    expect(screen.queryByText('Assistance requested')).not.toBeInTheDocument();
    unmount();

    clearQueryCache();
    api.getAssistance.mockResolvedValue({
      active: true, requestedAt: Date.now(), userName: null,
      ack: { name: null, at: Date.now() }, // users:read scope missing
    });
    render(<AssistanceBar enabled />);
    expect(await screen.findByText('A tech team member')).toBeInTheDocument();
  });
});

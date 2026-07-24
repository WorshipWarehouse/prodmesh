import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistanceDialog } from './AssistanceDialog';
import { clearQueryCache } from '../lib/useQuery';

const api = vi.hoisted(() => ({
  requestAssistance: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  ...api,
}));

beforeEach(() => {
  clearQueryCache();
  api.requestAssistance.mockReset();
});

describe('AssistanceDialog', () => {
  it('sends the typed problem and closes', async () => {
    api.requestAssistance.mockResolvedValue({ active: true });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AssistanceDialog onClose={onClose} />);

    await user.type(
      screen.getByLabelText('Problem (optional)'),
      'Projector shows no signal',
    );
    await user.click(screen.getByRole('button', { name: 'Notify the tech team' }));

    expect(api.requestAssistance).toHaveBeenCalledWith('Projector shows no signal');
    expect(onClose).toHaveBeenCalled();
  });

  it('sends with no message at all — a panicking volunteer is never blocked', async () => {
    api.requestAssistance.mockResolvedValue({ active: true });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AssistanceDialog onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Notify the tech team' }));

    expect(api.requestAssistance).toHaveBeenCalledWith(undefined);
    expect(onClose).toHaveBeenCalled();
  });

  it('a failed send keeps the dialog open with the error', async () => {
    api.requestAssistance.mockRejectedValue(new Error("Couldn't notify the tech team: down"));
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AssistanceDialog onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Notify the tech team' }));

    expect(await screen.findByText(/Couldn't notify the tech team/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

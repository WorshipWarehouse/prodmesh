import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Analytics } from './Analytics';
import type { HistoryShow } from '../api';

const api = vi.hoisted(() => ({
  getHistory: vi.fn(),
  deleteHistoryShow: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  ...api,
}));

const show = (over: Partial<HistoryShow>): HistoryShow => ({
  instanceId: 'p1__t1',
  roomId: 'north-main',
  roomName: 'Main Auditorium',
  site: 'north',
  planId: 'p1',
  timeId: 't1',
  planTitle: 'Sunday Service',
  serviceTypeName: 'Sunday',
  dates: 'July 27',
  timeName: '1st Service',
  timeStartsAt: '2026-07-26T16:00:00Z',
  startedAt: Date.now() - 3600_000,
  completedAt: Date.now() - 1800_000,
  itemCount: 5,
  totals: { planned: 3600, actual: 3700, delta: 100 },
  spl: null,
  rehearsal: false,
  ...over,
});

const rows = [
  show({}),
  show({
    instanceId: 'p1__rehearsal-123',
    timeId: 'rehearsal-123',
    planTitle: 'Tuesday Practice',
    rehearsal: true,
  }),
];

beforeEach(() => {
  api.getHistory.mockReset();
  api.deleteHistoryShow.mockReset();
  api.getHistory.mockResolvedValue({ shows: rows });
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <Analytics />
    </MemoryRouter>,
  );

describe('Analytics', () => {
  it('badges rehearsal rows and leaves service rows unbadged', async () => {
    renderPage();

    const practice = (await screen.findByText('Tuesday Practice')).closest('.hist__row')!;
    expect(within(practice as HTMLElement).getByText('Rehearsal')).toBeInTheDocument();
    const service = screen.getByText('Sunday Service').closest('.hist__row')!;
    expect(within(service as HTMLElement).queryByText('Rehearsal')).not.toBeInTheDocument();
  });

  it('deletes a run after confirmation and drops the row', async () => {
    api.deleteHistoryShow.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Delete Tuesday Practice' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/erased permanently/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete run' }));

    expect(api.deleteHistoryShow).toHaveBeenCalledWith('p1__rehearsal-123');
    await waitFor(() => expect(screen.queryByText('Tuesday Practice')).not.toBeInTheDocument());
    expect(screen.getByText('Sunday Service')).toBeInTheDocument(); // others untouched
  });

  it('cancel keeps the run; a failed delete shows the error and keeps the row', async () => {
    api.deleteHistoryShow.mockRejectedValue(new Error('permission_required'));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Delete Sunday Service' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.deleteHistoryShow).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete Sunday Service' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete run' }));
    expect(await within(screen.getByRole('dialog')).findByText('permission_required')).toBeInTheDocument();
    // Row still present (the title also appears in the open dialog, hence All).
    expect(screen.getAllByText('Sunday Service').length).toBeGreaterThanOrEqual(2);
  });
});

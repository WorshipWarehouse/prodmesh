import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonPicker } from './PersonPicker';
import type { PlanningCenterPerson } from '../api';

const api = vi.hoisted(() => ({ searchPlanningCenterPeople: vi.fn() }));

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  ...api,
}));

const MEGAN: PlanningCenterPerson = { id: '900001', name: 'Avery Stone', avatarUrl: 'https://pc.test/avery.jpg' };
const ANDY: PlanningCenterPerson = { id: '900002', name: 'Riley Chen', avatarUrl: null };

/** Live search, unless a test says otherwise. */
const connected = (people: PlanningCenterPerson[] = [MEGAN, ANDY]) =>
  api.searchPlanningCenterPeople.mockImplementation(async (q: string) =>
    ({ configured: true, people: q ? people : [] }));

describe('PersonPicker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('searches by name and hands back the person ID', async () => {
    connected();
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PersonPicker value="" onChange={onChange} />);

    const input = await screen.findByRole('combobox');
    await user.type(input, 'avery');

    await user.click(await screen.findByRole('option', { name: /Avery Stone/ }));
    expect(onChange).toHaveBeenCalledWith('900001');
    // The picked person stays visible — an ID alone is unverifiable at a glance.
    expect(screen.getByText('Avery Stone')).toBeInTheDocument();
    expect(screen.getByText('PCO 900001')).toBeInTheDocument();
  });

  it('picks with the keyboard', async () => {
    connected();
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PersonPicker value="" onChange={onChange} />);

    await user.type(await screen.findByRole('combobox'), 'torres');
    await screen.findByRole('option', { name: /Avery Stone/ });

    // The first row is active on arrival, so one ArrowDown lands on Riley.
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('900002');
  });

  it('unlinks a person', async () => {
    connected();
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<PersonPicker value="" onChange={onChange} />);

    await user.type(await screen.findByRole('combobox'), 'avery');
    await user.click(await screen.findByRole('option', { name: /Avery Stone/ }));
    rerender(<PersonPicker value="900001" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Unlink Avery Stone' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('waits for typing to settle before searching', async () => {
    connected();
    const user = userEvent.setup();
    render(<PersonPicker value="" onChange={vi.fn()} />);

    await user.type(await screen.findByRole('combobox'), 'avery');
    await screen.findByRole('option', { name: /Avery Stone/ });

    // One probe on mount plus one search — not one request per keystroke.
    expect(api.searchPlanningCenterPeople).toHaveBeenCalledTimes(2);
    expect(api.searchPlanningCenterPeople).toHaveBeenLastCalledWith('avery');
  });

  it('never searches on a single letter', async () => {
    connected();
    const user = userEvent.setup();
    render(<PersonPicker value="" onChange={vi.fn()} />);

    await user.type(await screen.findByRole('combobox'), 'm');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(api.searchPlanningCenterPeople).toHaveBeenCalledTimes(1); // the mount probe
  });

  it('flags someone who no longer serves', async () => {
    connected([{ ...MEGAN, inactive: true }]);
    const user = userEvent.setup();
    render(<PersonPicker value="" onChange={vi.fn()} />);

    await user.type(await screen.findByRole('combobox'), 'avery');
    expect(await screen.findByText('PCO 900001 · Inactive')).toBeInTheDocument();
  });

  it('says nothing matched', async () => {
    connected([]);
    const user = userEvent.setup();
    render(<PersonPicker value="" onChange={vi.fn()} />);

    await user.type(await screen.findByRole('combobox'), 'zzz');
    expect(await screen.findByText('No matches.')).toBeInTheDocument();
  });

  it('distinguishes a failed search from nobody by that name', async () => {
    // Silently showing "No matches." would have an admin conclude the person
    // is not in Planning Center, when in fact the server never answered.
    api.searchPlanningCenterPeople.mockImplementation(async (q: string) => {
      if (!q) return { configured: true, people: [] };
      throw new Error('HTTP 502');
    });
    const user = userEvent.setup();
    render(<PersonPicker value="" onChange={vi.fn()} />);

    await user.type(await screen.findByRole('combobox'), 'avery');
    expect(await screen.findByText(/didn’t answer/)).toBeInTheDocument();
  });

  it('links a typed ID directly, and does not pretend to know whose it is', async () => {
    // The way through when search is down, a name is spelled unexpectedly, or
    // the admin already has the number in front of them.
    connected([]);
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PersonPicker value="" onChange={onChange} />);

    await user.type(await screen.findByRole('combobox'), '442310777');
    await user.click(await screen.findByRole('option', { name: /442310777/ }));

    expect(onChange).toHaveBeenCalledWith('442310777');
    expect(screen.getByText('Name not checked')).toBeInTheDocument();
  });

  it('offers the typed ID even when the search itself failed', async () => {
    api.searchPlanningCenterPeople.mockImplementation(async (q: string) => {
      if (!q) return { configured: true, people: [] };
      throw new Error('HTTP 502');
    });
    const user = userEvent.setup();
    render(<PersonPicker value="" onChange={vi.fn()} />);

    await user.type(await screen.findByRole('combobox'), '442310777');
    expect(await screen.findByText(/didn’t answer/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /442310777/ })).toBeInTheDocument();
  });

  it('falls back to a typed ID when Planning Center is not connected', async () => {
    api.searchPlanningCenterPeople.mockResolvedValue({ configured: false, people: [] });
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PersonPicker value="" onChange={onChange} />);

    const input = await screen.findByPlaceholderText('Person ID (optional)');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await user.type(input, '9');
    expect(onChange).toHaveBeenCalledWith('9');
  });

  it('falls back to a typed ID when the probe fails outright', async () => {
    // No server, no permission, no network — creating users must not depend on
    // an integration being reachable.
    api.searchPlanningCenterPeople.mockRejectedValue(new Error('HTTP 403'));
    render(<PersonPicker value="" onChange={vi.fn()} />);

    expect(await screen.findByPlaceholderText('Person ID (optional)')).toBeInTheDocument();
  });
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Calendar } from './Calendar';
import { CampusContext } from '../layout/campus';
import { clearQueryCache } from '../lib/useQuery';
import type { CalendarEvent } from '../api';

const api = vi.hoisted(() => ({
  getCalendar: vi.fn(),
  getRooms: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  ...api,
}));

const rooms = [
  { id: 'north-main', name: 'Main Auditorium', site: 'north', hasCompanion: true, modes: [] },
  { id: 'south-main', name: 'SE Auditorium', site: 'south-everett', hasCompanion: false, modes: [] },
];

// Events pinned to "today" so they land inside the initially-rendered week.
const todayAt = (h: number) => {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

const events: CalendarEvent[] = [
  {
    id: 'e1', eventId: null, name: 'Worship Rehearsal', startsAt: todayAt(18), endsAt: todayAt(21),
    allDay: false, location: 'Main Auditorium', approval: 'A', roomIds: ['north-main'],
  },
  {
    id: 'e2', eventId: null, name: 'SE Setup', startsAt: todayAt(9), endsAt: todayAt(11),
    allDay: false, location: 'SE Auditorium', approval: 'A', roomIds: ['south-main'],
  },
  {
    id: 'e3', eventId: null, name: 'Memorial Service', startsAt: todayAt(10), endsAt: todayAt(12),
    allDay: false, location: 'Chapel', approval: 'P', roomIds: [],
  },
];

function renderPage(campusId = 'all') {
  return render(
    <CampusContext.Provider value={{ campusId, setCampusId: vi.fn() }}>
      <MemoryRouter>
        <Calendar />
      </MemoryRouter>
    </CampusContext.Provider>,
  );
}

beforeEach(() => {
  clearQueryCache();
  api.getCalendar.mockReset(); // vi.fn() call counts survive restoreMocks
  api.getRooms.mockReset();
  api.getRooms.mockResolvedValue(rooms);
  api.getCalendar.mockResolvedValue({
    live: false,
    start: new Date().toISOString(),
    end: new Date().toISOString(),
    events,
  });
});

describe('Calendar', () => {
  it('renders the week of bookings with room links and the demo pill', async () => {
    renderPage();

    expect(await screen.findByText('Worship Rehearsal')).toBeInTheDocument();
    expect(screen.getByText('· demo data')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Main Auditorium' }))
      .toHaveAttribute('href', '/room/north-main');

    // Unmapped location: no link, raw location text with the pending badge.
    const memorial = screen.getByText('Memorial Service').closest('.cal-ev')!;
    expect(within(memorial as HTMLElement).getByText('Chapel')).toBeInTheDocument();
    expect(within(memorial as HTMLElement).queryByRole('link')).not.toBeInTheDocument();
    expect(within(memorial as HTMLElement).getByText('pending')).toBeInTheDocument();
  });

  it('campus filter hides other campuses but never hides unmapped bookings', async () => {
    renderPage('north');

    expect(await screen.findByText('Worship Rehearsal')).toBeInTheDocument();
    expect(screen.queryByText('SE Setup')).not.toBeInTheDocument();
    expect(screen.getByText('Memorial Service')).toBeInTheDocument();
  });

  it('week navigation requests the next range', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Worship Rehearsal');
    const [firstStart] = api.getCalendar.mock.calls[0];

    await user.click(screen.getByRole('button', { name: 'Next week' }));

    await waitFor(() => expect(api.getCalendar).toHaveBeenCalledTimes(2));
    const [nextStart] = api.getCalendar.mock.calls[1];
    const delta = new Date(nextStart).getTime() - new Date(firstStart).getTime();
    expect(delta).toBe(7 * 86_400_000);

    // Back to the current week via Today.
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByText('Worship Rehearsal')).toBeInTheDocument();
  });
});

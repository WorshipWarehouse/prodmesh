import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RunOfShow } from './RunOfShow';
import { emitTopic } from '../test/fakeEventSource';
import { IdentityContext } from '../lib/identity';
import { PermissionError } from '../api';
import type { AuthStatus, ServicePlan, ShowState } from '../api';

const api = vi.hoisted(() => ({
  getRoom: vi.fn(),
  getRoomPlan: vi.fn(),
  getReport: vi.fn(),
  startShow: vi.fn(),
  endShow: vi.fn(),
  setShowCurrent: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  ...api,
}));

// The page subscribes through useTopic, which holds ONE EventSource on
// /api/stream carrying `msg` frames of {topic, data}. Split a combined
// ShowState into the three topics the server actually publishes it as.
async function emitState(state: ShowState) {
  const { timer = null, spl = null, ...show } = state;
  await emitTopic({
    'room:north-main:show': show,
    'room:north-main:timer': timer,
    'room:north-main:spl': spl,
  });
}

const item = (id: string, title: string, type: string | null = 'item') => ({
  id, sequence: null, title, type, length: null, key: null, leader: null, description: null,
});

// Headers between the songs — Prev/Next must skip them.
const plan: ServicePlan = {
  id: 'plan-1',
  serviceTypeId: '500001',
  serviceTypeName: 'Sunday',
  title: 'July 27 Service',
  seriesTitle: null,
  dates: 'July 27',
  sortDate: null,
  times: [
    { id: 't-svc', name: 'Service', startsAt: '2026-07-26T11:00:00Z', endsAt: null, type: 'service' },
  ],
  items: [
    item('i-welcome', 'Welcome'),
    item('h-worship', 'WORSHIP', 'header'),
    item('i-song', 'Song One', 'song'),
    item('h-teaching', 'TEACHING', 'header'),
    item('i-message', 'Message'),
  ],
};

const liveHere: ShowState = {
  active: true,
  roomId: 'north-main',
  planId: 'plan-1',
  timeId: 't-svc',
  follow: true,
  ppConnected: true,
  current: { itemId: 'i-welcome', itemIndex: 0, itemName: 'Welcome', slideIndex: null, slideCount: null },
};

/** An identity carrying exactly the permissions given, or none at all. */
const asUser = (permissions: string[], authenticated = true): AuthStatus => ({
  authenticated,
  admin: false,
  setupNeeded: false,
  user: authenticated
    ? { id: 'u1', username: 'sam', displayName: 'Sam Rivera', planningCenterPersonId: null }
    : null,
  permissions,
  station: null,
});

function renderPage(identity: AuthStatus | null = null) {
  return render(
    <IdentityContext.Provider value={identity}>
      <MemoryRouter initialEntries={['/room/north-main/run/plan-1?time=t-svc']}>
        <Routes>
          <Route path="/room/:roomId/run/:planId" element={<RunOfShow />} />
        </Routes>
      </MemoryRouter>
    </IdentityContext.Provider>,
  );
}

beforeEach(() => {
  api.getRoom.mockResolvedValue({
    id: 'north-main', name: 'Main Auditorium', site: 'north', hasCompanion: true, modes: [],
  });
  api.getRoomPlan.mockResolvedValue({ live: true, plan: structuredClone(plan) });
  api.getReport.mockResolvedValue({
    items: [], totals: { planned: 0, actual: 0, delta: 0 }, completedAt: null,
  });
});

describe('show identity', () => {
  it('ignores another show in the room: no live controls, just a link to it', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Start Show' })).toBeInTheDocument();

    // Active show in this room, but for a DIFFERENT plan/time.
    await emitState({ ...liveHere, planId: 'plan-OTHER', timeId: 't-other' });

    expect(await screen.findByText('Another show is live in this room')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to it' }))
      .toHaveAttribute('href', '/room/north-main/run/plan-OTHER?time=t-other');
    expect(screen.queryByRole('button', { name: 'End Show' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Show' })).not.toBeInTheDocument();
  });

  it('same active state with matching planId+timeId renders the live controls', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Start Show' });

    await emitState(liveHere);

    expect(await screen.findByRole('button', { name: 'End Show' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prev' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.queryByText('Another show is live in this room')).not.toBeInTheDocument();
  });

  it('an active show with matching ids but for a different service time is not ours', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Start Show' });

    await emitState({ ...liveHere, timeId: 't-second-service' });

    expect(await screen.findByText('Another show is live in this room')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End Show' })).not.toBeInTheDocument();
  });
});

describe('start → live controls', () => {
  it('starts the show and swaps Start for Prev/Next/End', async () => {
    api.startShow.mockResolvedValue(liveHere);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Start Show' }));

    expect(api.startShow).toHaveBeenCalledWith('north-main', 'plan-1', 't-svc');
    expect(await screen.findByRole('button', { name: 'End Show' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prev' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Show' })).not.toBeInTheDocument();
    expect(screen.queryByText('No show running')).not.toBeInTheDocument();
  });
});

describe('start rehearsal', () => {
  it('starts under the server-issued rehearsal timeId and shows the Rehearsal chip', async () => {
    api.startShow.mockResolvedValue({ ...liveHere, timeId: 'rehearsal-1753000000000' });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Start Rehearsal' }));

    expect(api.startShow).toHaveBeenCalledWith('north-main', 'plan-1', 't-svc', { rehearsal: true });
    // The page adopts the rehearsal instance: live controls + Rehearsal chip.
    expect(await screen.findByRole('button', { name: 'End Show' })).toBeInTheDocument();
    expect(screen.getByText('Rehearsal')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Show' })).not.toBeInTheDocument();
  });
});

// Start Show used to 403 into a `catch {}` — the button visibly did nothing,
// which during a service is indistinguishable from a hung server.
describe('permission to operate', () => {
  it('a failed start says why instead of looking like a dead button', async () => {
    api.startShow.mockRejectedValue(new PermissionError('shows.operate', 'Operate shows', true));
    const user = userEvent.setup();
    renderPage(); // identity unknown — the button is offered, the server refuses

    await user.click(await screen.findByRole('button', { name: 'Start Show' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your account cannot operate shows.');
    expect(screen.getByRole('button', { name: 'Start Show' })).toBeEnabled();
  });

  it('surfaces a conflict from the server verbatim', async () => {
    api.startShow.mockRejectedValue(new Error('A show is already active in this room'));
    const user = userEvent.setup();
    renderPage(asUser(['shows.operate']));

    await user.click(await screen.findByRole('button', { name: 'Start Show' }));

    expect(await screen.findByRole('alert'))
      .toHaveTextContent('A show is already active in this room');
  });

  it('an operator without the permission is not offered the controls at all', async () => {
    renderPage(asUser(['reports.view']));

    expect(await screen.findByText('Your account cannot operate shows.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Show' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Rehearsal' })).not.toBeInTheDocument();
  });

  it('a read-only station gets a way in, not just a wall', async () => {
    const asked = vi.fn();
    window.addEventListener('prodmesh:auth-required', asked);
    const user = userEvent.setup();
    renderPage(asUser([], false));

    await user.click(await screen.findByRole('button', { name: 'Log in to operate' }));

    expect(asked).toHaveBeenCalled();
    expect(asked.mock.calls[0][0].detail)
      .toEqual({ permission: 'shows.operate', label: 'Operate shows' });
    window.removeEventListener('prodmesh:auth-required', asked);
  });

  it('hides the live controls too — watching a show is not operating it', async () => {
    renderPage(asUser(['reports.view']));
    await screen.findByText('Your account cannot operate shows.');

    await emitState(liveHere);

    // Still shows what is happening…
    expect(await screen.findByText('Now')).toBeInTheDocument();
    expect(screen.getByText('Following ProPresenter')).toBeInTheDocument();
    // …but offers no way to change it.
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End Show' })).not.toBeInTheDocument();
  });

  it('an administrator (permissions: *) keeps every control', async () => {
    renderPage(asUser(['*']));
    expect(await screen.findByRole('button', { name: 'Start Show' })).toBeInTheDocument();
  });
});

describe('Prev/Next header skipping', () => {
  it('Next and Prev jump to the adjacent NON-header item', async () => {
    api.setShowCurrent.mockImplementation(async (_room: string, body: { itemId?: string }) => ({
      ...liveHere,
      current: { ...liveHere.current!, itemId: body.itemId! },
    }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Start Show' });

    await emitState(liveHere); // current = i-welcome
    await screen.findByRole('button', { name: 'Next' });

    // Welcome → (skip WORSHIP header) → Song One
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(api.setShowCurrent).toHaveBeenLastCalledWith('north-main', { itemId: 'i-song' });

    // Song One → (skip TEACHING header) → Message
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(api.setShowCurrent).toHaveBeenLastCalledWith('north-main', { itemId: 'i-message' });

    // Last trackable item — Next disables.
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    // Message → (skip TEACHING header) → Song One
    await user.click(screen.getByRole('button', { name: 'Prev' }));
    expect(api.setShowCurrent).toHaveBeenLastCalledWith('north-main', { itemId: 'i-song' });
    expect(api.setShowCurrent).toHaveBeenCalledTimes(3);
  });
});

describe('completed show', () => {
  it('shows Complete + Reopen instead of Start when the report carries completedAt', async () => {
    api.getReport.mockResolvedValue({
      items: [], totals: { planned: 0, actual: 0, delta: 0 },
      completedAt: new Date('2026-07-26T12:15:00Z').getTime(),
    });
    api.startShow.mockResolvedValue(liveHere);
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/Complete ·/)).toBeInTheDocument();
    const reopen = screen.getByRole('button', { name: 'Reopen show' });
    expect(screen.queryByRole('button', { name: 'Start Show' })).not.toBeInTheDocument();
    expect(
      screen.getByText('This service is complete — see the show report for how it ran.'),
    ).toBeInTheDocument();

    await user.click(reopen);
    expect(api.startShow).toHaveBeenCalledWith('north-main', 'plan-1', 't-svc');
  });

  it('freezes the counter into the recorded service length instead of ticking on', async () => {
    api.getReport.mockResolvedValue({
      items: [], totals: { planned: 0, actual: 0, delta: 0 },
      startedAt: new Date('2026-07-26T11:02:00Z').getTime(),
      completedAt: new Date('2026-07-26T12:15:30Z').getTime(),
    });
    renderPage();

    expect(await screen.findByText('Service length')).toBeInTheDocument();
    expect(screen.getByText('1:13:30')).toBeInTheDocument();
    expect(screen.getByText(/Ended/)).toBeInTheDocument();
    expect(screen.queryByText('Elapsed since start')).not.toBeInTheDocument();

    // Even a running PP timer (counting to the next service) must not unfreeze it.
    await emitState({
      active: false,
      timer: { uuid: null, name: 'Walk In', state: 'running', remainingSeconds: 300, targetSecondsOfDay: null, countsDownToTime: false },
    });
    expect(screen.getByText('Service length')).toBeInTheDocument();
    expect(screen.queryByText('05:00')).not.toBeInTheDocument();
  });
});

describe('SPL meter zones', () => {
  const spl = (current: number) => ({
    active: false as const,
    spl: { current, avg: null, peak: null, target: 90, limit: 95 },
  });

  it('colors green under target, amber at/over target, red at/over limit', async () => {
    const { container } = renderPage();
    await screen.findByRole('button', { name: 'Start Show' });

    await emitState(spl(89.9));
    expect(screen.getByText(/89\.9/)).toBeInTheDocument();
    expect(container.querySelector('.wgt--spl')).toHaveClass('ros-spl--ok');

    await emitState(spl(90)); // at target — warn starts at the boundary
    expect(container.querySelector('.wgt--spl')).toHaveClass('ros-spl--warn');

    await emitState(spl(94.9));
    expect(container.querySelector('.wgt--spl')).toHaveClass('ros-spl--warn');

    await emitState(spl(95)); // at limit — over starts at the boundary
    expect(container.querySelector('.wgt--spl')).toHaveClass('ros-spl--over');
  });
});

describe('countdown source priority', () => {
  const timer = (state: string) => ({
    uuid: null,
    name: 'Walk In',
    state,
    remainingSeconds: 300,
    targetSecondsOfDay: null,
    countsDownToTime: false,
  });

  it('a RUNNING PP timer wins over clock math; a stopped one falls back to startsAt', async () => {
    // Freeze "now" exactly 1h before the plan's service time (2026-07-26T11:00Z).
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-26T10:00:00Z').getTime());
    renderPage();

    // No timer yet → clock math against the Planning Center time.
    expect(await screen.findByText('1:00:00')).toBeInTheDocument();

    await emitState({ active: false, timer: timer('running') });
    expect(screen.getByText('05:00')).toBeInTheDocument();
    expect(screen.getByText(/Walk In/)).toBeInTheDocument();
    expect(screen.queryByText('1:00:00')).not.toBeInTheDocument();

    await emitState({ active: false, timer: timer('stopped') });
    await waitFor(() => expect(screen.getByText('1:00:00')).toBeInTheDocument());
    expect(screen.queryByText('05:00')).not.toBeInTheDocument();
    expect(screen.queryByText(/Walk In/)).not.toBeInTheDocument();
  });
});

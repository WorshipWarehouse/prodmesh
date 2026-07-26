import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RunOfShow } from './RunOfShow';
import type { ServicePlan, ShowState } from '../api';

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

// The page subscribes via `es.addEventListener('state', …)` — a controllable
// fake lets tests push server show-state frames like the real SSE stream does.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  private listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? new Set()) {
      fn({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

const emitState = (state: ShowState) =>
  act(() => FakeEventSource.instances.at(-1)!.emit('state', state));

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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/room/north-main/run/plan-1?time=t-svc']}>
      <Routes>
        <Route path="/room/:roomId/run/:planId" element={<RunOfShow />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  api.getRoom.mockResolvedValue({
    id: 'north-main', name: 'Main Auditorium', site: 'north', hasCompanion: true, modes: [],
  });
  api.getRoomPlan.mockResolvedValue({ live: true, plan: structuredClone(plan) });
  api.getReport.mockResolvedValue({
    items: [], totals: { planned: 0, actual: 0, delta: 0 }, completedAt: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('show identity', () => {
  it('ignores another show in the room: no live controls, just a link to it', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Start Show' })).toBeInTheDocument();

    // Active show in this room, but for a DIFFERENT plan/time.
    emitState({ ...liveHere, planId: 'plan-OTHER', timeId: 't-other' });

    expect(await screen.findByText('Another show is live in this room')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to it' }))
      .toHaveAttribute('href', '/room/north-main/run/plan-OTHER?time=t-other');
    expect(screen.queryByRole('button', { name: 'End Show' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Show' })).not.toBeInTheDocument();
  });

  it('same active state with matching planId+timeId renders the live controls', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Start Show' });

    emitState(liveHere);

    expect(await screen.findByRole('button', { name: 'End Show' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prev' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.queryByText('Another show is live in this room')).not.toBeInTheDocument();
  });

  it('an active show with matching ids but for a different service time is not ours', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Start Show' });

    emitState({ ...liveHere, timeId: 't-second-service' });

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

describe('Prev/Next header skipping', () => {
  it('Next and Prev jump to the adjacent NON-header item', async () => {
    api.setShowCurrent.mockImplementation(async (_room: string, body: { itemId?: string }) => ({
      ...liveHere,
      current: { ...liveHere.current!, itemId: body.itemId! },
    }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Start Show' });

    emitState(liveHere); // current = i-welcome
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
    emitState({
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

    emitState(spl(89.9));
    expect(screen.getByText(/89\.9/)).toBeInTheDocument();
    expect(container.querySelector('.ros-spl')).toHaveClass('ros-spl--ok');

    emitState(spl(90)); // at target — warn starts at the boundary
    expect(container.querySelector('.ros-spl')).toHaveClass('ros-spl--warn');

    emitState(spl(94.9));
    expect(container.querySelector('.ros-spl')).toHaveClass('ros-spl--warn');

    emitState(spl(95)); // at limit — over starts at the boundary
    expect(container.querySelector('.ros-spl')).toHaveClass('ros-spl--over');
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

    emitState({ active: false, timer: timer('running') });
    expect(screen.getByText('05:00')).toBeInTheDocument();
    expect(screen.getByText(/Walk In/)).toBeInTheDocument();
    expect(screen.queryByText('1:00:00')).not.toBeInTheDocument();

    emitState({ active: false, timer: timer('stopped') });
    await waitFor(() => expect(screen.getByText('1:00:00')).toBeInTheDocument());
    expect(screen.queryByText('05:00')).not.toBeInTheDocument();
    expect(screen.queryByText(/Walk In/)).not.toBeInTheDocument();
  });
});

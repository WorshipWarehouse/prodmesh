import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { widgetRegistry } from './registry';
import { IdentityContext } from '../lib/identity';
import { clearQueryCache } from '../lib/useQuery';
import { emitTopic } from '../test/fakeEventSource';
import type { AuthStatus, ServicePlan, ShowState } from '../api';

// The permission branches, mirroring what RunOfShow.test.tsx covers for the
// page — because the widget shares that behaviour through useShowActions, and
// a shared thing is only shared if both sides are held to it.

const api = vi.hoisted(() => ({
  getRoomPlan: vi.fn(),
  getRoomService: vi.fn(),
  setShowCurrent: vi.fn(),
  startShow: vi.fn(),
  endShow: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  ...api,
}));

const item = (id: string, title: string, type: string | null = 'item') => ({
  id, sequence: null, title, type, length: null, key: null, leader: null, description: null,
});

const plan: ServicePlan = {
  id: 'plan-1', serviceTypeId: 'st', serviceTypeName: 'Sunday', title: 'Weekend Service',
  seriesTitle: null, dates: 'August 9', sortDate: null,
  times: [{ id: 'svc', name: '1st Service', startsAt: '2026-08-09T16:00:00Z', endsAt: null, type: 'service' }],
  items: [item('i-welcome', 'Welcome'), item('h', 'WORSHIP', 'header'), item('i-song', 'Song One')],
};

const live: ShowState = {
  active: true, roomId: 'north-main', planId: 'plan-1', timeId: 'svc',
  follow: true, ppConnected: true,
  current: { itemId: 'i-welcome', itemIndex: 0, itemName: 'Welcome', slideIndex: null, slideCount: null },
};

const identity = (permissions: string[], authenticated = true): AuthStatus => ({
  authenticated, admin: false, setupNeeded: false,
  user: authenticated ? { id: 'u1', username: 'sam', displayName: 'Sam', planningCenterPersonId: null } : null,
  permissions, station: null,
});

const Widget = widgetRegistry['run-of-show'].component;

function renderWidget(who: AuthStatus | null) {
  return render(
    <IdentityContext.Provider value={who}>
      <Widget roomId="north-main" config={{ planId: 'plan-1', timeId: 'svc' }} />
    </IdentityContext.Provider>,
  );
}

beforeEach(() => {
  clearQueryCache();
  api.getRoomPlan.mockReset().mockResolvedValue({ live: true, plan });
  api.getRoomService.mockReset().mockResolvedValue({ configured: true, live: true, plans: [plan] });
  api.setShowCurrent.mockReset().mockResolvedValue(live);
  api.startShow.mockReset().mockResolvedValue(live);
  api.endShow.mockReset().mockResolvedValue({ active: false });
});

describe('the run-of-show widget', () => {
  it('is dashboard-only — a display is defined as non-interactive', () => {
    expect(widgetRegistry['run-of-show'].kinds).toEqual(['dashboard']);
    expect(widgetRegistry['run-of-show'].size).toEqual({ w: 2, h: 3 });
  });

  it('drives the show for someone who may operate it', async () => {
    const user = userEvent.setup();
    renderWidget(identity(['shows.operate']));
    await screen.findByRole('button', { name: /Start Show/ });

    await emitTopic({ 'room:north-main:show': live });
    const next = await screen.findByRole('button', { name: /Next/ });
    await user.click(next);
    // Skips the header, exactly as the page does.
    expect(api.setShowCurrent).toHaveBeenCalledWith('north-main', { itemId: 'i-song' });
  });

  it('tells a logged-in operator without the permission, and offers nothing', async () => {
    renderWidget(identity(['reports.view']));
    expect(await screen.findByText('Your account cannot operate shows.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start Show/ })).not.toBeInTheDocument();

    await emitTopic({ 'room:north-main:show': live });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Next/ })).not.toBeInTheDocument());
    // Still shows what is happening — watching is not operating.
    expect(screen.getByText('Following ProPresenter')).toBeInTheDocument();
  });

  it('gives a read-only station the way in rather than just the wall', async () => {
    const asked = vi.fn();
    window.addEventListener('prodmesh:auth-required', asked);
    const user = userEvent.setup();
    renderWidget(identity([], false));

    await user.click(await screen.findByRole('button', { name: 'Log in to operate' }));
    expect(asked.mock.calls[0][0].detail).toEqual({
      permission: 'shows.operate', label: 'Operate shows',
    });
    window.removeEventListener('prodmesh:auth-required', asked);
  });

  it('surfaces a refusal instead of looking like a dead button', async () => {
    api.startShow.mockRejectedValue(new Error('A show is already active in this room'));
    const user = userEvent.setup();
    renderWidget(identity(['shows.operate']));

    await user.click(await screen.findByRole('button', { name: /Start Show/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A show is already active in this room');
  });

  it('ignores a show running for a different service', async () => {
    renderWidget(identity(['shows.operate']));
    await screen.findByRole('button', { name: /Start Show/ });

    await emitTopic({ 'room:north-main:show': { ...live, timeId: 'other' } });
    expect(await screen.findByText('Another show is live in this room')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next/ })).not.toBeInTheDocument();
  });
});

describe('the now-next widget', () => {
  const NowNext = widgetRegistry['now-next'].component;

  const renderNowNext = () =>
    render(<NowNext roomId="north-main" config={{ planId: 'plan-1', timeId: 'svc' }} />);

  it('goes on a display, and takes no actions there', () => {
    expect(widgetRegistry['now-next'].kinds).toBeUndefined(); // both kinds
    expect(widgetRegistry['now-next'].size).toEqual({ w: 3, h: 1 });
    renderNowNext();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('names the current item and the one after it, skipping headers', async () => {
    renderNowNext();
    await emitTopic({ 'room:north-main:show': live });

    expect(await screen.findByText('Welcome')).toBeInTheDocument();
    expect(screen.getByText('Song One')).toBeInTheDocument();
    expect(screen.getByText('Now')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  it('says what is coming before anything has started', async () => {
    renderNowNext();
    expect(await screen.findByText('Not started')).toBeInTheDocument();
    // The first trackable item is what is next when nothing is live.
    expect(screen.getByText('Welcome')).toBeInTheDocument();
  });

  it('says so at the end rather than going blank', async () => {
    renderNowNext();
    await emitTopic({
      'room:north-main:show': { ...live, current: { ...live.current!, itemId: 'i-song' } },
    });
    expect(await screen.findByText('End of service')).toBeInTheDocument();
  });
});

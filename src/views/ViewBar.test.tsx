import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ViewBar } from './ViewBar';
import { emitTopic } from '../test/fakeEventSource';
import type { ServicePlan, ViewSummary } from '../api';
import type { WidgetConfig } from '../widgets/types';

const summary = (slug: string, name: string): ViewSummary => ({
  id: `id-${slug}`, roomId: 'north-main', kind: 'dashboard', name, slug,
  columns: 6, maxRows: null, position: 0, createdAt: 0, updatedAt: 0,
});

const plan: ServicePlan = {
  id: 'plan-1', serviceTypeId: 'st', serviceTypeName: 'Sunday',
  title: 'Weekend Service', seriesTitle: null, dates: 'Sunday, August 9', sortDate: null,
  times: [
    { id: 'reh', name: 'Run Through', startsAt: '2026-08-09T15:00:00Z', endsAt: null, type: 'rehearsal' },
    { id: 'svc', name: '1st Service', startsAt: '2026-08-09T16:00:00Z', endsAt: null, type: 'service' },
  ],
  items: [],
};

function Harness({
  config = {},
  onChange = vi.fn(),
  plans = [plan],
}: {
  config?: WidgetConfig;
  onChange?: (c: WidgetConfig) => void;
  plans?: ServicePlan[];
}) {
  return (
    <MemoryRouter initialEntries={['/room/north-main/view/foh']}>
      <Routes>
        {/* Switching dashboards lands on this same route, so the location
            readout has to live inside it rather than in a catch-all. */}
        <Route
          path="/room/:roomId/view/:slug"
          element={
            <>
              <ViewBar
                roomId="north-main"
                view={summary('foh', 'Front of House')}
                siblings={[summary('foh', 'Front of House'), summary('producer', 'Service Producer')]}
                plans={plans}
                config={config}
                onChange={onChange}
              />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

const Where = () => <p>at {useLocation().pathname}</p>;

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.useRealTimers());

describe('ViewBar', () => {
  it('is a labelled control per field, not decoration a screen reader repeats', () => {
    render(<Harness />);
    // The visible face is aria-hidden; the real <select> carries the label.
    expect(screen.getByLabelText('Dashboard')).toBeInTheDocument();
    expect(screen.getByLabelText('Event')).toBeInTheDocument();
    expect(screen.getByLabelText('Service time')).toBeInTheDocument();
    // Exactly one accessible node per control — the face is not a second one.
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
  });

  it('the title doubles as the switcher', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText('Dashboard'), 'producer');
    expect(await screen.findByText('at /room/north-main/view/producer')).toBeInTheDocument();
  });

  it('picking an event pins to it, and the time list follows', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Harness onChange={onChange} />);

    // Service time is inert while following — the widgets choose their own.
    expect(screen.getByLabelText('Service time')).toBeDisabled();

    // The event list holds only events. Picking one pins, with no "leave
    // follow mode first" step.
    const events = screen.getByLabelText('Event') as HTMLSelectElement;
    expect([...events.options].map((o) => o.value)).toEqual(['plan-1']);
    await user.selectOptions(events, 'plan-1');
    expect(onChange).toHaveBeenCalledWith({ planId: 'plan-1' });

    rerender(<Harness config={{ planId: 'plan-1' }} onChange={onChange} />);
    const time = screen.getByLabelText('Service time');
    expect(time).toBeEnabled();
    await user.selectOptions(time, 'svc');
    expect(onChange).toHaveBeenLastCalledWith({ planId: 'plan-1', timeId: 'svc' });
  });

  describe('follow-the-room toggle', () => {
    const follow = () => screen.getByRole('button', { name: /Follow the room/ });

    it('is a pressed toggle while no event is pinned, and shows what it resolves to', () => {
      render(<Harness />);
      expect(follow()).toHaveAttribute('aria-pressed', 'true');
      // The control still names the event it currently resolves to, so it
      // never reads blank.
      expect(screen.getByText('Sunday, August 9')).toBeInTheDocument();
      expect(screen.getByText('Following the room')).toBeInTheDocument();
    });

    it('turning it off pins to whatever was already on screen', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<Harness onChange={onChange} />);
      await user.click(follow());
      // The same event, not a jump to something else — the dashboard's content
      // must not change just because someone took manual control of it.
      expect(onChange).toHaveBeenCalledWith({ planId: 'plan-1' });
    });

    it('turning it on clears the config rather than pinning anything', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<Harness config={{ planId: 'plan-1', timeId: 'svc' }} onChange={onChange} />);
      expect(follow()).toHaveAttribute('aria-pressed', 'false');
      await user.click(follow());
      // Empty, not {planId: undefined}: every widget falls back to the room's
      // own next service, which is what lets a lobby screen sit untouched.
      expect(onChange).toHaveBeenCalledWith({});
    });

    it('is inert when the room has no events to follow or pin', () => {
      render(<Harness plans={[]} />);
      expect(follow()).toBeDisabled();
      expect(screen.getByLabelText('Event')).toBeDisabled();
      expect(screen.getByText('No events')).toBeInTheDocument();
    });
  });

  it('shows the room going live, and counts up', async () => {
    render(<Harness />);
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();

    // The ROOM's show, not this dashboard's context — a producer on a rehearsal
    // layout still needs to know the 9:30 went live.
    await emitTopic({
      'room:north-main:show': {
        active: true, roomId: 'north-main', planId: 'plan-1', timeId: 'svc',
        startedAt: Date.now() - 90_000, follow: true, ppConnected: true, current: null,
      },
    });

    expect(await screen.findByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText('01:30')).toBeInTheDocument();
  });
});

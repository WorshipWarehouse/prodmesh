import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { widgetRegistry, widgetTypes, isWidgetType } from './registry';
import { spanColumns, type WidgetSpan } from './types';
import { emitTopic } from '../test/fakeEventSource';

const api = vi.hoisted(() => ({
  getRoomService: vi.fn(),
  getRoomPlan: vi.fn(),
  getReport: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  ...api,
}));

const plan = {
  id: 'plan-9',
  serviceTypeId: 'st',
  serviceTypeName: 'Sunday',
  title: 'August 9 Service',
  seriesTitle: null,
  dates: 'August 9',
  sortDate: null,
  times: [
    { id: 't-rehearse', name: 'Rehearsal', startsAt: '2026-08-09T14:00:00Z', endsAt: null, type: 'rehearsal' },
    { id: 't-svc', name: '1st Service', startsAt: '2026-08-09T17:00:00Z', endsAt: null, type: 'service' },
  ],
  items: [],
};

beforeEach(() => {
  // mockReset, not just mockResolvedValue: call counts otherwise accumulate
  // across tests, and "this widget did NOT fetch the other thing" is half of
  // what the placement tests below assert.
  api.getRoomService.mockReset().mockResolvedValue({ configured: true, live: true, plans: [plan] });
  api.getRoomPlan.mockReset().mockResolvedValue({ live: true, plan });
  api.getReport.mockReset().mockResolvedValue({
    items: [], totals: { planned: 0, actual: 0, delta: 0 }, completedAt: null,
  });
});

describe('the registry contract', () => {
  it('every registered widget renders from a room id and nothing else', async () => {
    // This is the whole contract, enforced mechanically: a stored layout can
    // only place a widget from data, so a widget that needs props from a
    // surrounding page cannot be placed. Adding one fails right here.
    for (const type of widgetTypes) {
      const W = widgetRegistry[type].component;
      const view = render(<W roomId="north-main" config={{}} />);
      view.unmount();
    }
  });

  it('describes every widget for a future layout picker', () => {
    for (const type of widgetTypes) {
      const def = widgetRegistry[type];
      expect(def.title, `${type} needs a title`).toBeTruthy();
      expect(def.description, `${type} needs a description`).toBeTruthy();
      expect(spanColumns(def.defaultSpan), `${type} needs a usable span`).toBeGreaterThan(0);
    }
  });

  it('recognises its own type names and rejects others', () => {
    expect(isWidgetType('loudness')).toBe(true);
    expect(isWidgetType('nope')).toBe(false);
  });
});

describe('column spans', () => {
  it('maps the legacy names onto the 12-col grid', () => {
    expect(spanColumns('half')).toBe(6);
    expect(spanColumns('third')).toBe(4);
    expect(spanColumns('two-thirds')).toBe(8);
  });

  it('takes any column count a stored layout might hold, and rejects nonsense', () => {
    expect(spanColumns(1)).toBe(1);
    expect(spanColumns(5)).toBe(5);
    expect(spanColumns(12)).toBe(12);
    expect(spanColumns(undefined)).toBeNull();
    // Casts on purpose: these are the values that arrive from the DATABASE,
    // where WidgetSpan is a promise nothing has enforced. TypeScript rejecting
    // them at this call site is the point — the runtime guard is for the other
    // door.
    expect(spanColumns(0 as WidgetSpan)).toBeNull();
    expect(spanColumns(13 as WidgetSpan)).toBeNull();
    expect(spanColumns(2.5 as WidgetSpan)).toBeNull();
    expect(spanColumns('enormous' as WidgetSpan)).toBeNull();
  });
});

describe('CountdownWidget placement', () => {
  it('follows the room’s next service when no plan is pinned', async () => {
    // The dashboard case: a lobby screen must not need reconfiguring weekly.
    render(<widgetRegistry.countdown.component roomId="north-main" config={{}} />);

    await waitFor(() => expect(api.getRoomService).toHaveBeenCalledWith('north-main'));
    // The plan's first SERVICE time, not its rehearsal.
    expect(await screen.findByText(/1st Service/)).toBeInTheDocument();
    expect(api.getRoomPlan).not.toHaveBeenCalled();
  });

  it('uses the pinned plan and time when given one', async () => {
    render(
      <widgetRegistry.countdown.component
        roomId="north-main"
        config={{ planId: 'plan-9', timeId: 't-rehearse' }}
      />,
    );

    await waitFor(() => expect(api.getRoomPlan).toHaveBeenCalledWith('north-main', 'plan-9'));
    expect(await screen.findByText(/Rehearsal/)).toBeInTheDocument();
    expect(api.getRoomService).not.toHaveBeenCalled();
  });

  it('lets a running ProPresenter timer win over clock math', async () => {
    render(<widgetRegistry.countdown.component roomId="north-main" config={{}} />);
    await screen.findByText(/1st Service/);

    await emitTopic({
      'room:north-main:timer': {
        uuid: 'u1', name: 'Service Start', state: 'running',
        remainingSeconds: 300, targetSecondsOfDay: null, countsDownToTime: false,
      },
    });

    expect(await screen.findByText('05:00')).toBeInTheDocument();
    expect(screen.getByText(/Service Start/)).toBeInTheDocument();
  });
});

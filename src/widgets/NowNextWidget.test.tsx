import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NowNextWidget } from './NowNextWidget';
import { emitTopic } from '../test/fakeEventSource';

const api = vi.hoisted(() => ({ getRoomService: vi.fn(), getRoomPlan: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  ...api,
}));

const plan = {
  id: 'plan-9',
  serviceTypeId: 'st',
  serviceTypeName: 'Sunday',
  title: 'August 9',
  seriesTitle: null,
  dates: 'August 9',
  sortDate: null,
  times: [{ id: 'svc-1', name: '1st Service', startsAt: null, endsAt: null, type: 'service' }],
  items: [
    { id: 'i1', sequence: 1, title: 'Welcome', type: 'item', length: null },
    { id: 'i2', sequence: 2, title: 'Worship', type: 'item', length: null },
  ],
};

const show = (over = {}) => ({
  active: true, roomId: 'north-main', planId: 'plan-9', timeId: 'svc-1', startedAt: 1, ...over,
});

const mount = () => render(<NowNextWidget roomId="north-main" config={{}} />);
const push = (data: unknown) => emitTopic({ 'room:north-main:show': data });
const bar = () => document.querySelector('.ros-progress__fill') as HTMLElement | null;

beforeEach(() => {
  api.getRoomService.mockReset().mockResolvedValue({ configured: true, live: true, plans: [plan] });
  api.getRoomPlan.mockReset().mockResolvedValue({ live: true, plan });
});

describe('NowNextWidget slide progress', () => {
  it('draws no bar before a show is running', async () => {
    mount();
    await screen.findByText('Welcome'); // the first item, as Next
    expect(bar()).toBeNull();
  });

  it('shows how far ProPresenter is through the current item', async () => {
    mount();
    await push(show({ current: { itemId: 'i2', itemIndex: 1, itemName: 'Worship', slideIndex: 2, slideCount: 8 } }));
    expect(await screen.findByText('3/8')).toBeInTheDocument();
    // slideIndex is zero-based, so slide 3 of 8 is 37.5% — off-by-one here
    // would read as a bar that never reaches the end of an item.
    expect(bar()).toHaveStyle({ width: '37.5%' });
  });

  it('fills completely on the last slide', async () => {
    mount();
    await push(show({ current: { itemId: 'i2', itemIndex: 1, itemName: 'Worship', slideIndex: 7, slideCount: 8 } }));
    expect(bar()).toHaveStyle({ width: '100%' });
  });

  it('draws nothing when ProPresenter has not supplied a slide count', async () => {
    // readSlideCount can fail or the arrangement can be unknown, and a bar
    // with no denominator is a decoration rather than information.
    mount();
    await push(show({ current: { itemId: 'i2', itemIndex: 1, itemName: 'Worship', slideIndex: 2, slideCount: null } }));
    await screen.findByText('Worship');
    expect(bar()).toBeNull();
  });

  it('drops the bar when the show ends rather than leaving the last one up', async () => {
    mount();
    await push(show({ current: { itemId: 'i2', itemIndex: 1, itemName: 'Worship', slideIndex: 2, slideCount: 8 } }));
    expect(await screen.findByText('3/8')).toBeInTheDocument();

    await push({ active: false });
    expect(bar()).toBeNull();
  });

  it('shows a playing video instead of the slide bar, never both', async () => {
    // ProPresenter reports a slide index during media playback, so without the
    // either/or these are two bars describing the same thing.
    mount();
    await push(show({ current: { itemId: 'i2', itemIndex: 1, itemName: 'Bumper', slideIndex: 2, slideCount: 8 } }));
    expect(await screen.findByText('3/8')).toBeInTheDocument();

    await emitTopic({
      'room:north-main:video': { name: 'bumper.mov', seconds: 52.09, duration: 116.86, audioOnly: false },
    });
    expect(await screen.findByText('0:52 / 1:56')).toBeInTheDocument();
    expect(screen.queryByText('3/8')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.ros-progress__bar')).toHaveLength(1);
    expect(bar()).toHaveStyle({ width: `${(52.09 / 116.86) * 100}%` });
  });

  it('falls back to the slide bar the moment the video stops', async () => {
    // The server publishes null rather than a frozen position, because
    // ProPresenter cannot tell stopped from paused — see INTEGRATION-NOTES.
    mount();
    await push(show({ current: { itemId: 'i2', itemIndex: 1, itemName: 'Bumper', slideIndex: 2, slideCount: 8 } }));
    await emitTopic({ 'room:north-main:video': { name: 'b.mov', seconds: 10, duration: 100, audioOnly: false } });
    expect(await screen.findByText('0:10 / 1:40')).toBeInTheDocument();

    await emitTopic({ 'room:north-main:video': null });
    expect(await screen.findByText('3/8')).toBeInTheDocument();
  });

  it('shows a pre-service loop with no show running at all', async () => {
    // The most-watched video of the morning has no show behind it, which is
    // why the video topic is not scoped to one.
    api.getRoomService.mockResolvedValue({ configured: true, live: true, plans: [] });
    const { container } = render(<NowNextWidget roomId="north-main" config={{}} />);
    expect(container).toBeEmptyDOMElement();

    await emitTopic({
      'room:north-main:video': { name: 'loop.mov', seconds: 30, duration: 600, audioOnly: false },
    });
    expect(await screen.findByText('0:30 / 10:00')).toBeInTheDocument();
  });

  it('ignores a show running for a different service', async () => {
    // The widget was placed for one service; another one being live in the
    // room says nothing about it, and its slide count says even less.
    mount();
    await push(show({ timeId: 'svc-2', current: { itemId: 'i2', itemIndex: 1, itemName: 'W', slideIndex: 2, slideCount: 8 } }));
    await screen.findByText('Welcome');
    expect(bar()).toBeNull();
  });
});

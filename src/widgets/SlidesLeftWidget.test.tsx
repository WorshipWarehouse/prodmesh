import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SlidesLeftWidget } from './SlidesLeftWidget';
import { emitTopic } from '../test/fakeEventSource';

// Scoping runs through usePlan, which resolves a PINNED plan by fetching it —
// so the pin only takes effect once that request lands. Without these mocks the
// pinned test passes for the wrong reason: the fetch fails, planId comes back
// null, and nothing is scoped at all.
const api = vi.hoisted(() => ({ getRoomService: vi.fn(), getRoomPlan: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  ...api,
}));

const otherPlan = {
  id: 'other',
  serviceTypeId: 'st',
  serviceTypeName: 'Sunday',
  title: 'Another service',
  seriesTitle: null,
  dates: '',
  sortDate: null,
  times: [{ id: 'svc-9', name: '1st Service', startsAt: null, endsAt: null, type: 'service' }],
  items: [],
};

beforeEach(() => {
  api.getRoomService.mockReset().mockResolvedValue({ configured: true, live: true, plans: [] });
  api.getRoomPlan.mockReset().mockResolvedValue({ live: true, plan: otherPlan });
});

const show = () => render(<SlidesLeftWidget roomId="north-main" config={{}} />);

const live = (slideIndex: number | null, slideCount: number | null) => ({
  active: true,
  planId: 'p1',
  timeId: 't1',
  current: { itemId: 'i1', itemIndex: 0, itemName: 'Song', slideIndex, slideCount },
});

const push = (over: { showState?: unknown; video?: unknown }) =>
  emitTopic({
    'room:north-main:show': over.showState,
    'room:north-main:video': over.video ?? null,
  });

const card = () => document.querySelector('.wgt--left');
const value = () => document.querySelector('.wgt__value')?.textContent;
const title = () => document.querySelector('.wgt__title')?.textContent;

describe('SlidesLeftWidget', () => {
  it('renders nothing when nothing is running and nothing is playing', async () => {
    // An empty cell, not a zero. A zero is a number a director would act on.
    const { container } = show();
    expect(container).toBeEmptyDOMElement();

    await push({ showState: { active: false } });
    expect(container).toBeEmptyDOMElement();
  });

  it('counts slides REMAINING, not the position', async () => {
    // "Slide 6 of 11" tells a director where they are; "5 left" tells them what
    // to do. The countdown is the entire reason this widget exists.
    show();
    await push({ showState: live(5, 11) });
    expect(title()).toBe('Slides left');
    expect(value()).toContain('5');
  });

  it('says zero on the last slide rather than one', async () => {
    // Off-by-one here means the director gets their warning a slide late,
    // which is the one moment it matters.
    show();
    await push({ showState: live(10, 11) });
    expect(value()).toContain('0');
  });

  it('turns amber at five and red at two', async () => {
    show();
    await push({ showState: live(4, 11) }); // 6 left
    expect(card()?.className).toContain('wgt--left--ok');

    await push({ showState: live(5, 11) }); // 5 left
    expect(card()?.className).toContain('wgt--left--warn');

    await push({ showState: live(8, 11) }); // 2 left
    expect(card()?.className).toContain('wgt--left--over');

    await push({ showState: live(10, 11) }); // 0 left
    expect(card()?.className).toContain('wgt--left--over');
  });

  it('never signals with colour alone', async () => {
    // A director who cannot separate amber from red still has to get the
    // message, and so does anyone reading this through a screen reader.
    show();
    await push({ showState: live(5, 11) });
    expect(screen.getByText(/ending soon/)).toBeInTheDocument();

    await push({ showState: live(9, 11) });
    expect(screen.getByText(/ending now/)).toBeInTheDocument();
  });

  it('becomes a video clock while a video plays, and the video wins', async () => {
    // ProPresenter reports a slide index straight through media playback, so
    // without the precedence rule this counts down slides nobody is watching.
    show();
    await push({
      showState: live(2, 11),
      video: { name: 'bumper.mov', seconds: 14, duration: 120 },
    });
    expect(title()).toBe('Video left');
    expect(value()).toContain('1:46');
  });

  it('warns on the video clock at thirty seconds and ten', async () => {
    show();
    await push({ showState: live(2, 11), video: { name: 'v', seconds: 60, duration: 120 } });
    expect(card()?.className).toContain('wgt--left--ok');

    await push({ showState: live(2, 11), video: { name: 'v', seconds: 95, duration: 120 } });
    expect(card()?.className).toContain('wgt--left--warn');

    await push({ showState: live(2, 11), video: { name: 'v', seconds: 115, duration: 120 } });
    expect(card()?.className).toContain('wgt--left--over');
  });

  it('falls back to the slide count the moment the video stops', async () => {
    // The video topic publishes null for a STOPPED video rather than freezing
    // — otherwise this widget pins 0:00 for the rest of the service.
    show();
    await push({ showState: live(2, 11), video: { name: 'v', seconds: 119, duration: 120 } });
    expect(title()).toBe('Video left');

    await push({ showState: live(2, 11), video: null });
    expect(title()).toBe('Slides left');
    expect(value()).toContain('8');
  });

  it('shows nothing rather than a bar with no denominator', async () => {
    // ProPresenter reports a slide index with no count on some builds. Half a
    // fraction is not a countdown.
    show();
    await push({ showState: live(3, null) });
    expect(card()).toBeNull();

    await push({ showState: live(null, 11) });
    expect(card()).toBeNull();

    await push({ showState: live(3, 0) });
    expect(card()).toBeNull();
  });

  it('ignores a show that is not this widget’s service', async () => {
    // A different service being live in the room says nothing about the one
    // this tile was placed for.
    render(<SlidesLeftWidget roomId="north-main" config={{ planId: 'other' }} />);
    await push({ showState: live(5, 11) }); // the live show is plan p1
    // The pin only bites once its plan has been fetched, so waiting for that
    // request is what makes this test about scoping rather than about timing.
    await waitFor(() => expect(api.getRoomPlan).toHaveBeenCalledWith('north-main', 'other'));
    await waitFor(() => expect(card()).toBeNull());
  });

  it('counts down a video with no show running at all', async () => {
    // The pre-service loop is the most-watched video of the morning and there
    // is no show behind it.
    show();
    await push({ showState: { active: false }, video: { name: 'loop', seconds: 10, duration: 70 } });
    expect(title()).toBe('Video left');
    expect(value()).toContain('1:00');
  });
});

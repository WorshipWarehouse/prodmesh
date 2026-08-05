import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoudnessTrendWidget } from './LoudnessTrendWidget';
import { emitTopic } from '../test/fakeEventSource';

// The widget thins its samples on Date.now(); this drives that clock without
// faking timers, which would interfere with testing-library's own waiting.
// Re-installed per test because the suite runs with restoreMocks.
let clock = 1_000_000;
beforeEach(() => {
  clock = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});

const show = () => render(<LoudnessTrendWidget roomId="north-main" config={{}} />);
const push = (data: unknown) => emitTopic({ 'room:north-main:spl': data });
/** Advance past the throttle window so the next sample is kept. */
const later = () => {
  clock += 6000;
};

const spl = (current: number, over = {}) => ({
  current, avg: null, peak: null, target: 96, limit: 100, ...over,
});

describe('LoudnessTrendWidget', () => {
  it('renders nothing when the room has no analyzer', async () => {
    const { container } = show();
    await push(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the current level and starts recording', async () => {
    show();
    await push(spl(84.2));
    expect(await screen.findByText(/84\.2/)).toBeInTheDocument();
    expect(screen.getByText('Recording…')).toBeInTheDocument();
  });

  it('draws a curve once it has watched two samples', async () => {
    const { container } = show();
    await push(spl(84.2));
    expect(container.querySelector('.spark__line')).toBeNull();

    later();
    await push(spl(87.5));
    expect(container.querySelector('.spark__line')).not.toBeNull();
    // The window is named, because the curve covers what THIS SCREEN has seen
    // — a reload starts it over, and the service's real history is the Show
    // Report's, not this.
    expect(screen.getByText(/on this screen/)).toBeInTheDocument();
  });

  it('thins a 1 Hz source instead of drawing several minutes of noise', async () => {
    const { container } = show();
    await push(spl(84.2));
    await push(spl(84.4)); // same second — skipped
    await push(spl(84.6));
    expect(container.querySelector('.spark__line')).toBeNull();

    later();
    await push(spl(85.0));
    expect(container.querySelector('.spark__line')).not.toBeNull();
  });

  it('colours itself by the same bands as the meter', async () => {
    const { container } = show();
    await push(spl(97));
    expect(container.querySelector('.ros-spl--warn')).not.toBeNull();

    later();
    await push(spl(101));
    expect(container.querySelector('.ros-spl--over')).not.toBeNull();
  });

  it('drops the curve when the analyzer stops', async () => {
    const { container } = show();
    await push(spl(84.2));
    later();
    await push(spl(87.5));
    expect(container.querySelector('.spark__line')).not.toBeNull();

    await push(null);
    expect(container).toBeEmptyDOMElement();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ViewersWidget } from './ViewersWidget';
import { Sparkline } from '../components/Sparkline';
import { emitTopic } from '../test/fakeEventSource';

const show = () => render(<ViewersWidget roomId="north-main" config={{}} />);
const push = (data: unknown) => emitTopic({ 'room:north-main:youtube': data });

describe('ViewersWidget', () => {
  it('renders nothing at all before the room has said anything', () => {
    const { container } = show();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the room is not streaming', async () => {
    const { container } = show();
    await push(null);
    // A "0 watching" tile on a Tuesday is noise, and reads as a fault.
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the live count, formatted for a number people will read aloud', async () => {
    show();
    await push({ current: 1234, peak: 1300, avg: 900, live: true });
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    expect(screen.getByText(/peak 1,300/)).toBeInTheDocument();
    expect(screen.getByText(/avg 900/)).toBeInTheDocument();
  });

  it('says the counter is hidden rather than showing a zero', async () => {
    // The broadcaster can switch the count off on YouTube's side. A 0 here
    // would be a fabricated attendance figure someone might repeat.
    show();
    await push({ current: null, peak: null, avg: null, live: true });
    expect(await screen.findByText('—')).toBeInTheDocument();
    expect(screen.getByText(/hidden on YouTube/)).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('keeps the recorded peak visible after the stream ends', async () => {
    show();
    await push({ current: null, peak: 812, avg: 640, live: false });
    expect(await screen.findByText(/Stream ended/)).toBeInTheDocument();
  });

  it('attributes the number to YouTube, which is what their mark is for', async () => {
    show();
    await push({ current: 427, peak: 427, avg: 413, live: true });
    const mark = await screen.findByTitle('Viewer counts from the YouTube Data API');
    // alt="" and a title: decoration that carries attribution, not a second
    // reading of "Current viewers" for a screen reader.
    expect(mark).toHaveAttribute('alt', '');
    // Vite inlines it, so assert what actually ships: an SVG in YouTube's own
    // red, which the guidelines require be left alone.
    const src = mark.getAttribute('src') ?? '';
    expect(src).toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(src)).toContain('#FF0033');
  });

  it('records its own curve, because YouTube does not serve one', async () => {
    // concurrentViewers is a single number that exists only while live —
    // there is no history to ask for, so the curve is what this screen has
    // watched happen since it was opened. It needs two points to be a line.
    const { container } = show();
    await push({ current: 400, peak: 400, avg: 400, live: true });
    expect(container.querySelector('.spark__line')).toBeNull();

    await push({ current: 427, peak: 427, avg: 413, live: true });
    expect(container.querySelector('.spark__line')).not.toBeNull();
    expect(screen.getByText('427')).toBeInTheDocument();
  });

  it('drops the curve when the stream ends, rather than leaving a stale one up', async () => {
    const { container } = show();
    await push({ current: 400, peak: 400, avg: 400, live: true });
    await push({ current: 427, peak: 427, avg: 413, live: true });
    expect(container.querySelector('.spark__line')).not.toBeNull();

    await push({ current: null, peak: 427, avg: 413, live: false });
    expect(container.querySelector('.spark__line')).toBeNull();
  });
});

describe('Sparkline', () => {
  it('needs at least two points to be a line', () => {
    const { container } = render(<Sparkline points={[5]} label="x" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('draws a flat series without dividing by zero', () => {
    // max === min, so the naive scale is 0/0 and every y becomes NaN, which
    // silently produces an invalid path attribute rather than an error.
    const { container } = render(<Sparkline points={[7, 7, 7]} label="flat" />);
    const d = container.querySelector('.spark__line')?.getAttribute('d') ?? '';
    expect(d).not.toMatch(/NaN/);
    expect(d.length).toBeGreaterThan(0);
  });

  it('is labelled for screen readers, which cannot see a shape', () => {
    render(<Sparkline points={[1, 9, 4]} label="Concurrent viewers, peaking at 9" />);
    expect(screen.getByRole('img', { name: /peaking at 9/ })).toBeInTheDocument();
  });

  it('spans the full width regardless of the values', () => {
    const { container } = render(<Sparkline points={[3, 1, 8, 2]} label="x" />);
    const d = container.querySelector('.spark__line')!.getAttribute('d')!;
    expect(d.startsWith('M0.0,')).toBe(true);
    expect(d).toContain('L240.0,');
  });

  it('draws no gradient or marks when no bands are asked for', () => {
    // The viewers curve has no thresholds — nothing to compare a subscriber
    // count against — so it must stay exactly as plain as it was.
    const { container } = render(<Sparkline points={[1, 2, 3]} label="x" />);
    expect(container.querySelector('linearGradient')).toBeNull();
    expect(container.querySelector('.spark__mark')).toBeNull();
    expect(container.querySelector('.spark__line')).not.toHaveAttribute('style');
  });

  it('fits the data by default and honours fixed bounds when given', () => {
    const flat = [84, 84.5, 84];
    const auto = render(<Sparkline points={flat} label="x" />);
    const fixed = render(<Sparkline points={flat} label="x" bounds={{ min: 70, max: 100 }} />);
    const yOf = (c: HTMLElement) =>
      Number(c.querySelector('.spark__line')!.getAttribute('d')!.match(/^M0\.0,([\d.]+)/)![1]);

    // Auto-fit stretches a half-decibel wobble across the whole box — 84 dB
    // lands on the floor purely because it is the smallest number present.
    // The fixed window puts 84 dB where 84 dB belongs, just under half way up.
    expect(yOf(auto.container)).toBeCloseTo(46, 0);
    expect(yOf(fixed.container)).toBeCloseTo(25.5, 0);
  });

  it('clamps a value that runs off the top of a fixed window', () => {
    // A room CAN exceed the scale. The path must not escape the viewBox.
    const { container } = render(
      <Sparkline points={[95, 130]} label="x" bounds={{ min: 70, max: 100 }} />,
    );
    const ys = [...container.querySelector('.spark__line')!.getAttribute('d')!.matchAll(/,([\d.]+)/g)]
      .map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...ys)).toBeLessThanOrEqual(46);
  });

  it('turns bands into hard gradient stops, worst at the top', () => {
    const { container } = render(
      <Sparkline
        points={[80, 98]}
        label="x"
        bounds={{ min: 70, max: 100 }}
        bands={[{ from: 90, tone: 'warn' }, { from: 95, tone: 'over' }]}
      />,
    );
    const tones = [...container.querySelectorAll('stop')].map(
      (s) => s.getAttribute('class')?.replace('spark__stop spark__stop--', ''),
    );
    // Top of the box is the loudest, so 'over' leads and 'ok' closes.
    expect(tones).toEqual(['over', 'over', 'warn', 'warn', 'ok', 'ok']);

    // Hard, not blended: each boundary is two stops at the same offset.
    const offsets = [...container.querySelectorAll('stop')].map((s) => Number(s.getAttribute('offset')));
    expect(offsets[1]).toBeCloseTo(offsets[2], 5);
    expect(offsets[3]).toBeCloseTo(offsets[4], 5);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));

    // And a visible line at each threshold — colour alone says something
    // changed, not what number it changed at.
    expect(container.querySelectorAll('.spark__mark')).toHaveLength(2);
  });

  it('accepts bands in any order and still paints top-down', () => {
    const { container } = render(
      <Sparkline points={[80, 98]} label="x" bands={[{ from: 95, tone: 'over' }, { from: 90, tone: 'warn' }]} />,
    );
    const tones = [...container.querySelectorAll('stop')].map(
      (s) => s.getAttribute('class')?.replace('spark__stop spark__stop--', ''),
    );
    expect(tones[0]).toBe('over');
    expect(tones.at(-1)).toBe('ok');
  });
});

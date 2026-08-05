import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClockWidget } from './ClockWidget';

// Locale and timezone are the machine's, so the expected strings are built the
// same way the widget builds them. What is under test is WHEN the component
// re-reads the clock, not how Intl formats it.
const expected = (d: Date) =>
  d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const date = (d: Date) =>
  d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

/** The whole clock face. AM/PM is a nested <small>, so textContent is the only
 *  way to assert the string a person actually reads. */
const face = (c: HTMLElement) =>
  c.querySelector('.wgt__value')?.textContent?.replace(/\s+/g, ' ').trim();

afterEach(() => vi.useRealTimers());

describe('ClockWidget', () => {
  it('shows the time with seconds, and the date as its header', () => {
    const at = new Date(2026, 7, 5, 10, 42, 7);
    vi.useFakeTimers();
    vi.setSystemTime(at);
    const { container } = render(<ClockWidget />);

    expect(face(container)).toBe(expected(at));
    expect(screen.getByText(date(at))).toBeInTheDocument();
  });

  it('sets AM/PM apart so the digits do not have to shrink to fit', () => {
    // "11:17:38 AM" at one size wraps out of a two-column cell, and a clock
    // broken across two lines is not a clock. A 24-hour locale has no
    // dayPeriod part at all, which is why this is skipped rather than asserted
    // there — the widget renders nothing extra in that case.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 5, 10, 42, 7));
    const { container } = render(<ClockWidget />);

    const small = container.querySelector('.wgt__value small');
    const hasPeriod = /[AP]M/i.test(expected(new Date(2026, 7, 5, 10, 42, 7)));
    if (hasPeriod) expect(small?.textContent?.trim()).toMatch(/^[AP]M$/i);
    else expect(small).toBeNull();
  });

  it('ticks on the second boundary rather than a flat interval', () => {
    // Mounted 400ms into the second. A setInterval(1000) would leave 10:42:07
    // on screen for another 600ms after the wall clock said 08 — and would
    // stay 600ms late for the rest of the service, drifting further every time
    // the browser fired a timer late. Somebody is cueing against this.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 5, 10, 42, 7, 400));
    const { container } = render(<ClockWidget />);
    expect(face(container)).toBe(expected(new Date(2026, 7, 5, 10, 42, 7)));

    act(() => void vi.advanceTimersByTime(600));
    expect(face(container)).toBe(expected(new Date(2026, 7, 5, 10, 42, 8)));

    // And the next one is a full second later, not another 600ms.
    act(() => void vi.advanceTimersByTime(999));
    expect(face(container)).toBe(expected(new Date(2026, 7, 5, 10, 42, 8)));
    act(() => void vi.advanceTimersByTime(1));
    expect(face(container)).toBe(expected(new Date(2026, 7, 5, 10, 42, 9)));
  });

  it('rolls the date over at midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 5, 23, 59, 59));
    render(<ClockWidget />);
    expect(screen.getByText(date(new Date(2026, 7, 5)))).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByText(date(new Date(2026, 7, 6)))).toBeInTheDocument();
  });
});

import { describe, expect, it } from 'vitest';
import { hhmmss } from './duration';

describe('hhmmss', () => {
  it('keeps seconds visible close to service time', () => {
    // Sunday morning is the whole point of this widget — the last hour has to
    // tick.
    expect(hhmmss(45)).toBe('00:45');
    expect(hhmmss(605)).toBe('10:05');
    expect(hhmmss(3600)).toBe('1:00:00');
    expect(hhmmss(3661)).toBe('1:01:01');
  });

  it('switches to days once hours stop being readable', () => {
    // An event next Sunday used to render "151:43:45", which nobody parses as
    // six days.
    expect(hhmmss(86400)).toBe('1d 00h');
    expect(hhmmss(151 * 3600 + 43 * 60 + 45)).toBe('6d 07h');
  });

  it('never renders a negative countdown', () => {
    expect(hhmmss(-30)).toBe('00:00');
  });
});

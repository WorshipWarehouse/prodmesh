import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CaptionsWidget } from './CaptionsWidget';
import { emitTopic } from '../test/fakeEventSource';

const show = () => render(<CaptionsWidget roomId="north-main" config={{}} />);
const push = (data: unknown) => emitTopic({ 'room:north-main:captions': data });

const CHANNELS = [
  { ch: '0', name: 'MD', color: '#e0603a' },
  { ch: '6', name: 'Monitors', color: '#52a8ff' },
];
const line = (over = {}) => ({ id: 'a', ch: '0', text: 'two bars', live: false, at: 1, ...over });
const rail = () => [...document.querySelectorAll('.cap__ch')];
const rows = () => [...document.querySelectorAll('.cap__line')];

describe('CaptionsWidget', () => {
  it('renders nothing at all for a room with no caption source', async () => {
    // A permanent "not configured" panel on a stage screen is worse than an
    // empty cell — that room simply does not have the app.
    const { container } = show();
    expect(container).toBeEmptyDOMElement();
  });

  it('says so when the caption app is configured but not answering', async () => {
    show();
    await push({ up: false, channels: [], lines: [] });
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
  });

  it('puts the NEWEST line last in the DOM order it renders', async () => {
    // The list is column-reverse, so the newest must be FIRST in the DOM to
    // appear at the bottom. Getting this backwards silently inverts the
    // transcript, which reads fine line by line and is nonsense overall.
    show();
    await push({
      up: true, channels: CHANNELS,
      lines: [line({ id: '1', text: 'first' }), line({ id: '2', text: 'second' })],
    });
    expect(rows().map((r) => r.querySelector('.cap__text')?.textContent))
      .toEqual(['second', 'first']);
  });

  it('names a speaker once per run, not once per line', async () => {
    show();
    await push({
      up: true, channels: CHANNELS,
      lines: [
        line({ id: '1', ch: '0', text: 'a' }),
        line({ id: '2', ch: '0', text: 'b' }),
        line({ id: '3', ch: '6', text: 'c' }),
        line({ id: '4', ch: '0', text: 'd' }),
      ],
    });
    // Only the first line of each run shows the name; the rest keep it for a
    // screen reader (.sr-only), which has no colour column to look up.
    const visible = rows()
      .map((r) => r.querySelector('.cap__who'))
      .filter((n) => n && !n.classList.contains('sr-only'))
      .map((n) => n!.textContent);
    // Rendered newest-first: d opens a run, c opens a run, a opens the first.
    expect(visible).toEqual(['MD', 'Monitors', 'MD']);
    // Every line still announces its speaker.
    expect(rows().every((r) => r.querySelector('.cap__who')?.textContent)).toBe(true);
  });

  it('marks a speaker as talking only while they have an unfinished line', async () => {
    // Derived rather than subscribed: opting into the caption app's `speech`
    // event would silence its heartbeat (see INTEGRATION-NOTES), and ProdCom
    // has no such event at all.
    show();
    await push({ up: true, channels: CHANNELS, lines: [line({ ch: '0', live: true })] });
    expect(rail().map((r) => r.className.includes('cap__ch--live'))).toEqual([true, false]);
    expect(screen.getByText('— speaking')).toBeInTheDocument();

    await push({ up: true, channels: CHANNELS, lines: [line({ ch: '0', live: false })] });
    expect(rail().map((r) => r.className.includes('cap__ch--live'))).toEqual([false, false]);
  });

  it('stops showing anyone as talking when the connection drops', async () => {
    // Otherwise a crash mid-sentence leaves a speaker glowing forever, which
    // reads as "they are still on the channel" — the opposite of the truth.
    show();
    await push({ up: true, channels: CHANNELS, lines: [line({ ch: '0', live: true })] });
    expect(rail()[0].className).toContain('cap__ch--live');

    await push({ up: false, channels: CHANNELS, lines: [line({ ch: '0', live: true })] });
    expect(rail()[0].className).not.toContain('cap__ch--live');
  });

  it('carries each speaker’s own colour into both the rail and the line', async () => {
    show();
    await push({ up: true, channels: CHANNELS, lines: [line({ ch: '6' })] });
    expect(rail()[1].getAttribute('style')).toContain('#52a8ff');
    expect(rows()[0].getAttribute('style')).toContain('#52a8ff');
  });

  it('falls back to the name on the line when the roster has not arrived', async () => {
    // ProdCom denormalises channelName onto every entry, so a transcript is
    // readable before any roster does.
    show();
    await push({ up: true, channels: [], lines: [line({ ch: 'uuid-x', name: 'Stage Left TB' })] });
    expect(await screen.findByText('Stage Left TB')).toBeInTheDocument();
  });

  it('says it is listening rather than looking broken before anyone speaks', async () => {
    show();
    await push({ up: true, channels: CHANNELS, lines: [] });
    expect(await screen.findByText('Listening…')).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LyricsWidget } from './LyricsWidget';
import { emitTopic } from '../test/fakeEventSource';
import type { RoomLyrics } from '../api';

const show = () => render(<LyricsWidget roomId="north-main" config={{}} />);
const push = (data: unknown) => emitTopic({ 'room:north-main:lyrics': data });

const slide = (over: Partial<RoomLyrics['slides'][number]> = {}) => ({
  text: 'a line', section: 'Verse 1', color: '#0077cc', note: null, rep: null, ...over,
});

const rows = () => [...document.querySelectorAll('.lyr__row')];
const sections = () => [...document.querySelectorAll('.lyr__section')].map((n) => n.textContent);
const now = () => document.querySelector('.lyr__row--now');

// A song shaped like the one probed on 2026-08-11: a bridge played four times
// back to back, a chorus that comes round again much later, and a blank cue at
// the end with the operator's note on it.
const SONG: RoomLyrics = {
  name: 'Test Song',
  slides: [
    slide({ text: 'verse one line one', section: 'Verse 1' }),
    slide({ text: 'verse one line two', section: 'Verse 1' }),
    slide({ text: 'the chorus', section: 'Chorus 1', color: '#cc004e' }),
    slide({ text: 'the bridge', section: 'Bridge 1', color: '#7700cc', rep: { at: 1, of: 4 } }),
    slide({ text: 'the bridge', section: 'Bridge 1', color: '#7700cc', rep: { at: 2, of: 4 } }),
    slide({ text: 'the bridge', section: 'Bridge 1', color: '#7700cc', rep: { at: 3, of: 4 } }),
    slide({ text: 'the bridge', section: 'Bridge 1', color: '#7700cc', rep: { at: 4, of: 4 } }),
    slide({ text: 'the chorus', section: 'Chorus 1', color: '#cc004e' }),
    slide({ text: '', section: 'Blank', color: '#000000', note: 'piano' }),
  ],
  index: 0,
};

describe('LyricsWidget', () => {
  it('renders nothing when ProPresenter has no song open', async () => {
    // A permanent "no lyrics" panel on a stage screen is worse than an empty
    // cell — most of the service is not a song.
    const { container } = show();
    expect(container).toBeEmptyDOMElement();

    await push({ name: null, slides: [], index: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders every cue in playing order, repeats included', async () => {
    show();
    await push(SONG);
    expect(rows()).toHaveLength(9);
    expect(await screen.findByText('Test Song')).toBeInTheDocument();
  });

  it('marks a section once per PLAY, so each pass of a repeat is countable', async () => {
    // Four back-to-back bridges under one heading is twelve identical-looking
    // lines and no way to tell which one is up. The reprise of the chorus much
    // later is a different thing and gets no count.
    show();
    await push(SONG);
    expect(sections()).toEqual([
      'Verse 1',
      'Chorus 1',
      'Bridge 1 1 of 4',
      'Bridge 1 2 of 4',
      'Bridge 1 3 of 4',
      'Bridge 1 4 of 4',
      'Chorus 1',
      'Blank',
    ]);
  });

  it('does not repeat the section heading within one play of it', async () => {
    show();
    await push(SONG);
    // Two verse slides, one "Verse 1" heading.
    expect(sections().filter((s) => s === 'Verse 1')).toHaveLength(1);
  });

  it('follows the live slide, and only one row is live', async () => {
    show();
    await push(SONG);
    expect(now()?.textContent).toContain('verse one line one');

    await push({ ...SONG, index: 4 });
    expect(document.querySelectorAll('.lyr__row--now')).toHaveLength(1);
    expect(now()?.textContent).toContain('2 of 4');
  });

  it('splits a slide on the operator’s own line breaks', async () => {
    // The break is a decision someone made about where the phrase lands. A
    // paragraph reflowing it to the cell width undoes that.
    show();
    await push({ ...SONG, slides: [slide({ text: 'first phrase\nsecond phrase' })], index: 0 });
    expect([...document.querySelectorAll('.lyr__line')].map((n) => n.textContent))
      .toEqual(['first phrase', 'second phrase']);
  });

  it('shows a blank cue as a beat, labelled with the operator’s note', async () => {
    // An instrumental is not a gap to drop: skipping it makes the scroll look
    // like ProPresenter has hung right when the band is playing.
    show();
    await push({ ...SONG, index: 8 });
    const blank = document.querySelector('.lyr__row--blank');
    expect(blank).toBeTruthy();
    expect(blank?.textContent).toContain('piano');
    expect(now()).toBe(blank);
  });

  it('keeps an unlabelled blank cue as a silent beat, announced only to readers', async () => {
    // Live data: the Intro cue is blank with no note, and the section chip
    // above it already says "Intro". Printing NO TEXT under it says the same
    // thing twice on a widget meant to be read at a glance — but a screen
    // reader has no dashed rule to interpret, so the words stay in the DOM.
    show();
    await push({ ...SONG, slides: [slide({ text: '   ', section: 'Intro', note: null })], index: 0 });
    const blank = document.querySelector('.lyr__blank');
    expect(blank).toBeTruthy();
    expect(blank?.textContent?.trim()).toBe('No text');
    expect(blank?.querySelector('.sr-only')).toBeTruthy();
  });

  it('warns as the song runs out, and says which slide is the last', async () => {
    show();
    await push({ ...SONG, index: 0 });
    expect(screen.getByText('End of song')).toBeInTheDocument();
    expect(document.querySelector('.lyr__end--near')).toBeNull();

    await push({ ...SONG, index: 6 }); // two cues left
    expect(screen.getByText('2 to go')).toBeInTheDocument();
    expect(document.querySelector('.lyr__end--near')).toBeTruthy();

    await push({ ...SONG, index: 8 });
    expect(screen.getByText('Last slide')).toBeInTheDocument();
  });

  it('highlights nothing when the position is outside the song', async () => {
    // Means the arrangement we expanded is not the one being played. Showing
    // the song with nothing marked is honest; marking the wrong line is not.
    show();
    await push({ ...SONG, index: 99 });
    expect(rows()).toHaveLength(9);
    expect(now()).toBeNull();
    expect(document.querySelector('.lyr__pos')).toBeNull();

    await push({ ...SONG, index: null });
    expect(now()).toBeNull();
  });

  it('carries ProPresenter’s own section colour onto the row', async () => {
    show();
    await push(SONG);
    expect(rows()[2].getAttribute('style')).toContain('#cc004e');
  });

  it('replaces the whole song when ProPresenter moves to another one', async () => {
    show();
    await push(SONG);
    await push({ name: 'Next Song', slides: [slide({ text: 'brand new' })], index: 0 });
    expect(rows()).toHaveLength(1);
    expect(screen.getByText('brand new')).toBeInTheDocument();
    expect(screen.queryByText('the chorus')).toBeNull();
  });
});

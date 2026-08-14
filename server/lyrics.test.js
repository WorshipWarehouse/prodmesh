import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangeSlides, slideTotal } from './integrations/proPresenter.js';

// The SHAPE below is verbatim from ProPresenter 21.4 on 2026-08-13 (see
// docs/INTEGRATION-NOTES.md) — float colour components, an arrangement that is
// a flat list of group uuids with repeats, an empty-text "Blank" group with a
// note on it, and a presentation-level total_cues that is the RAW sum rather
// than the arranged one. The words are invented; nothing in server/ ships a
// real song, a real path or a real person's name.

const G = {
  intro: '00000000-0000-4000-8000-000000000001',
  verse: '00000000-0000-4000-8000-000000000002',
  chorus: '00000000-0000-4000-8000-000000000003',
  bridge: '00000000-0000-4000-8000-000000000004',
  blank: '00000000-0000-4000-8000-000000000005',
};

const PRES = {
  id: { uuid: 'PRES-0001', name: 'Test Song', index: 4 },
  groups: [
    {
      uuid: G.intro,
      name: 'Intro',
      color: { red: 0.7019608020782471, green: 0.6549019813537598, blue: 0.1411764770746231, alpha: 1 },
      slides: [{ enabled: true, notes: '', text: '', label: '' }],
    },
    {
      uuid: G.verse,
      name: 'Verse 1',
      color: { red: 0, green: 0.46666666865348816, blue: 0.800000011920929, alpha: 1 },
      slides: [
        { enabled: true, notes: 'lead in', text: 'first line here\nsecond line here', label: '' },
        { enabled: true, notes: '', text: 'third line here', label: '' },
      ],
    },
    {
      uuid: G.chorus,
      name: 'Chorus 1',
      color: { red: 0.800000011920929, green: 0, blue: 0.30588236451148987, alpha: 1 },
      slides: [{ enabled: true, notes: '', text: 'the chorus line', label: '' }],
    },
    {
      uuid: G.bridge,
      name: 'Bridge 1',
      color: { red: 0.4627451002597809, green: 0, blue: 0.800000011920929, alpha: 1 },
      slides: [{ enabled: true, notes: '', text: 'the bridge line', label: '' }],
    },
    {
      uuid: G.blank,
      name: 'Blank',
      color: { red: 0, green: 0, blue: 0, alpha: 1 },
      slides: [{ enabled: true, notes: 'piano', text: '', label: '' }],
    },
  ],
  arrangements: [
    {
      id: { uuid: 'ARR-SUNDAY', name: 'SUNDAY', index: 0 },
      // Bridge four times BACK TO BACK, chorus twice but far apart — the two
      // repeat cases that must read differently.
      groups: [G.intro, G.verse, G.chorus, G.bridge, G.bridge, G.bridge, G.bridge, G.chorus, G.blank],
      total_cues: 10, // nine group PLAYS, ten slides — Verse 1 is two of them
    },
    {
      id: { uuid: 'ARR-SHORT', name: 'Short', index: 1 },
      groups: [G.verse, G.chorus],
      total_cues: 3,
    },
  ],
  current_arrangement: '', // 21.4 really does answer with an empty string
  total_cues: 6, // the RAW group sum (1+2+1+1+1), not any arrangement's length
};

const texts = (list) => list.map((s) => s.text);
const sections = (list) => list.map((s) => s.section);

test('arrangeSlides plays the arrangement, not the group list', () => {
  // The trap the whole feature turns on. `groups` holds each section ONCE
  // however many times it is played; indexing into it addresses the wrong half
  // of the song from the first repeat onwards.
  const list = arrangeSlides(PRES, { uuid: 'ARR-SUNDAY' });
  assert.equal(list.length, 10);
  assert.equal(PRES.total_cues, 6, 'the presentation-level count is the raw sum');
  assert.notEqual(list.length, PRES.total_cues, 'and it is NOT what gets played');
  assert.deepEqual(sections(list), [
    'Intro', 'Verse 1', 'Verse 1', 'Chorus 1',
    'Bridge 1', 'Bridge 1', 'Bridge 1', 'Bridge 1',
    'Chorus 1', 'Blank',
  ]);
});

test('arrangeSlides expands every slide of every play, in running order', () => {
  const list = arrangeSlides(PRES, { uuid: 'ARR-SUNDAY' });
  assert.deepEqual(texts(list), [
    '',                                    // Intro
    'first line here\nsecond line here',   // Verse 1
    'third line here',
    'the chorus line',                     // Chorus 1
    'the bridge line',                     // Bridge 1 ×4
    'the bridge line',
    'the bridge line',
    'the bridge line',
    'the chorus line',                     // Chorus 1 again, later
    '',                                    // Blank
  ]);
});

test('arrangeSlides numbers a back-to-back run and leaves a later reprise alone', () => {
  // Four identical bridges in a row look like a frozen screen without this.
  // The chorus coming round again later is not the same thing and must not be
  // labelled "2 of 2" — nothing about the second one is a continuation.
  const list = arrangeSlides(PRES, { uuid: 'ARR-SUNDAY' });
  const bridges = list.filter((s) => s.section === 'Bridge 1');
  assert.deepEqual(bridges.map((s) => s.rep), [
    { at: 1, of: 4 }, { at: 2, of: 4 }, { at: 3, of: 4 }, { at: 4, of: 4 },
  ]);
  for (const s of list.filter((s2) => s2.section === 'Chorus 1')) {
    assert.equal(s.rep, null, 'a non-consecutive reprise is not a run');
  }
});

test('arrangeSlides identifies the arrangement by length when nothing else names it', () => {
  // PP 21.4's only route: it dropped presentation_info from the active playlist
  // item and answers current_arrangement with an empty string, so the cue count
  // from slide_index is the sole remaining signal.
  assert.equal(PRES.current_arrangement, '', 'the premise of this test');
  assert.equal(arrangeSlides(PRES, null, 3).length, 3);
  assert.deepEqual(sections(arrangeSlides(PRES, null, 3)), ['Verse 1', 'Verse 1', 'Chorus 1']);
  assert.equal(arrangeSlides(PRES, null, 10).length, 10);
});

test('arrangeSlides prefers an explicitly named arrangement over a matching length', () => {
  // PP 21.1 hands us the real arrangement on the playlist item. That beats
  // inferring one from a count that two arrangements could share.
  assert.deepEqual(sections(arrangeSlides(PRES, { name: 'Short' }, 10)), ['Verse 1', 'Verse 1', 'Chorus 1']);
});

test('arrangeSlides falls back to the raw group order when no arrangement fits', () => {
  // A presentation with no arrangements at all — most non-song material — and
  // the case where a count matches nothing.
  assert.equal(arrangeSlides(PRES, null, 999).length, 6);
  assert.equal(arrangeSlides({ ...PRES, arrangements: [] }).length, 6);
  assert.deepEqual(sections(arrangeSlides({ ...PRES, arrangements: [] })), [
    'Intro', 'Verse 1', 'Verse 1', 'Chorus 1', 'Bridge 1', 'Blank',
  ]);
});

test('arrangeSlides survives an arrangement referencing a group that is gone', () => {
  const broken = { ...PRES, arrangements: [{ id: { uuid: 'ARR-X' }, groups: [G.verse, 'DELETED', G.chorus] }] };
  assert.deepEqual(sections(arrangeSlides(broken, { uuid: 'ARR-X' })), ['Verse 1', 'Verse 1', 'Chorus 1']);
});

test('arrangeSlides carries ProPresenter’s own section colour as hex', () => {
  // The colours are the operator's, assigned in ProPresenter. Inventing our own
  // palette would mean the dashboard and the presentation disagree about which
  // block is the chorus.
  const list = arrangeSlides(PRES, { uuid: 'ARR-SUNDAY' });
  assert.equal(list.find((s) => s.section === 'Verse 1').color, '#0077cc');
  assert.equal(list.find((s) => s.section === 'Chorus 1').color, '#cc004e');
});

test('arrangeSlides reports an unstyled utility group as having NO colour', () => {
  // "Blank" and "Clear Background" both arrive as rgba(0,0,0,1) — the colour
  // ProPresenter leaves on groups nobody styles. Passing that through paints a
  // black dot and a black highlight bar onto a dark dashboard, which is the
  // same as drawing nothing while looking like a bug. Pure white is the same
  // problem on a light theme.
  const list = arrangeSlides(PRES, { uuid: 'ARR-SUNDAY' });
  assert.equal(list.find((s) => s.section === 'Blank').color, null);

  const white = { groups: [{ uuid: 'g', name: 'V', color: { red: 1, green: 1, blue: 1 }, slides: [{ text: 'x' }] }] };
  assert.equal(arrangeSlides(white)[0].color, null);

  // Near-black is still a choice somebody made, and stays one.
  const nearly = { groups: [{ uuid: 'g', name: 'V', color: { red: 0.05, green: 0, blue: 0 }, slides: [{ text: 'x' }] }] };
  assert.equal(arrangeSlides(nearly)[0].color, '#0d0000');
});

test('arrangeSlides survives 0–255 colour components', () => {
  // Documented as 0..1 floats and observed as 0..1 floats; this costs one line
  // and turns a whole-palette failure into a non-event if a build differs.
  const pres = {
    groups: [{ uuid: 'g', name: 'V', color: { red: 255, green: 128, blue: 0 }, slides: [{ text: 'x' }] }],
  };
  assert.equal(arrangeSlides(pres)[0].color, '#ff8000');
});

test('arrangeSlides keeps a blank slide, and its note', () => {
  // An empty-text slide is an instrumental beat, not a gap to be dropped: the
  // scroll has to keep moving through it or it reads as ProPresenter hanging.
  const list = arrangeSlides(PRES, { uuid: 'ARR-SUNDAY' });
  const blank = list.at(-1);
  assert.equal(blank.text, '');
  assert.equal(blank.section, 'Blank');
  assert.equal(blank.note, 'piano');
});

test('arrangeSlides turns an absent note into null rather than an empty string', () => {
  const list = arrangeSlides(PRES, { uuid: 'ARR-SUNDAY' });
  assert.equal(list[0].note, null);
  assert.equal(list.find((s) => s.text === 'first line here\nsecond line here').note, 'lead in');
});

test('arrangeSlides answers empty for nothing at all', () => {
  assert.deepEqual(arrangeSlides(null), []);
  assert.deepEqual(arrangeSlides(undefined), []);
  assert.deepEqual(arrangeSlides({}), []);
});

test('slideTotal is the length of the same expansion', () => {
  // One definition of "what order is this played in", so the Now & Next slide
  // bar and the lyric scroll cannot disagree about how long the song is.
  assert.equal(slideTotal(PRES, { uuid: 'ARR-SUNDAY' }), 10);
  assert.equal(slideTotal(PRES, { name: 'Short' }), 3);
  assert.equal(slideTotal({ ...PRES, arrangements: [] }), 6);
  assert.equal(slideTotal(null), null);
  assert.equal(slideTotal({ groups: [] }), null, 'zero is not a slide count');
});
